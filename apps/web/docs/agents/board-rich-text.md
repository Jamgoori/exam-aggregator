# 자유게시판 서식 본문(HTML) · 이미지 업로드 · 알림

자유게시판(`/board`)은 이 사이트에서 유일하게 **사용자가 쓴 HTML 을 화면에 그대로
그리는** 기능이다. 그래서 다른 게시판(건의·공지)과 규칙이 다르고, 그 차이를 모르고
고치면 저장형 XSS 가 된다. 본문·프로필 사진·알림에 손대기 전에 이 문서를 읽을 것.

## 1. 본문 HTML — 신뢰 경계는 서버 액션 한 곳

```
에디터(브라우저)  →  서버 액션  →  DB  →  화면
components/       app/board/     board_posts   components/
rich-text-editor  actions.ts     .content_html rich-text-content
                  ↑ 여기서만 새니타이즈
```

- **저장 전에 반드시 `sanitizeRichText()`**(`packages/core/src/rich-text.ts`)를 통과시킨
  결과만 `board_posts.content_html` 에 넣는다. `createBoardPost`/`updateBoardPost` 가
  그 자리다.
- 순서는 언제나 **새니타이즈 → 검증 → 저장**이다. 검증(`validateBoardPostInput`)을
  원본 HTML 에 대고 하면 "검사에 통과한 것과 저장된 것이 다른" 틈이 생긴다.
- 에디터가 만든 HTML 은 신뢰하지 않는다. 에디터에서 어떤 검사를 하든 그건 편의이고,
  폼 데이터를 직접 만들어 서버 액션을 호출하는 경로가 언제나 열려 있다.
- 화면에서 `dangerouslySetInnerHTML` 을 쓰는 곳은 `components/rich-text-content.tsx`
  **하나뿐**이다. 다른 곳에서 게시판 본문을 그리고 싶으면 이 컴포넌트를 쓸 것 —
  두 번째 지점을 만들면 그 지점만 새니타이즈를 건너뛰는 사고가 시간문제다.

### 새니타이저를 고칠 때

- 허용 목록(`ALLOWED_TAGS`, `STYLE_RULES`)에 **태그·속성·CSS 속성을 추가하는 것은
  기능 확장이 아니라 공격면 확장**이다. 추가할 때는 `rich-text.test.ts` 에 그 태그로
  스크립트를 심으려는 시도가 막히는지 확인하는 케이스를 함께 넣을 것.
- `style` 값은 이름만이 아니라 **값도** 판정한다(`url()`·`expression()` 이 값 검사에서
  떨어진다). 값 판정기를 느슨하게 바꾸지 말 것.
- 이미지 `src` 는 `imageOrigins` 접두사로만 통과시킨다. 임의의 외부 주소를 허용하면
  본문이 추적 픽셀 자리가 되고, 남의 서버 장애가 우리 화면의 깨진 이미지가 된다.
- 태그 균형은 스택으로 맞춘다(닫히지 않은 `<div>` 하나가 페이지 나머지를 삼키지
  않게). 정규식 치환만으로 태그를 지우는 방식으로 되돌리지 말 것.
- 이미지 `src` 는 접두사 검사 **뒤에** 경로 조각도 본다(`../`·`%2e%2e`·`?`·`#`·`\`
  거절). 접두사만 보면 `…/board-images/../../다른버킷` 이 같은 호스트의 다른 주소로
  풀린다(2026-09-04 점검에서 잡아 고쳤다 — `rich-text.test.ts` 의 "경로 탈출" 케이스).

### 점검 방법

새니타이저를 고쳤으면 XSS 페이로드 묶음(script·svg·mXSS·엔티티 우회·style 우회·
속성 탈출·경로 탈출 등 60여 종)을 한 번 돌려본다. `rich-text.test.ts` 가 그 요약본이다.
출력에 `on*=`·`javascript:`·`<script`·`<svg`·`expression(`·`url(` 가 남으면 실패.
`alt="x&quot; onload=…"` 처럼 **엔티티로 이스케이프된 채 남은 것은 통과**다 — 브라우저는
그걸 속성값 문자열 하나로 읽는다(검사식이 오탐한다).

## 2. 이미지 업로드 — 클라이언트가 버킷에 직접 올리지 않는다

`board-images`·`avatars` 두 버킷 모두 **읽기만 공개**이고 쓰기 정책이 없다
(`supabase/schema.sql`). 업로드는 서버 액션이 service_role 로 한다:

- `uploadBoardImage`(본문 이미지) — 가로 1600px 로 줄이고 webp 로 다시 굽는다.
- `uploadAvatar`(프로필 사진) — 256px 정사각 webp.

버킷에 `insert` 정책을 열어주면 이 리사이즈·형식 강제가 통째로 우회된다. 열지 말 것.
EXIF 회전(`.rotate()`)을 빼지 말 것 — 빼면 휴대폰 사진이 눕는다.
`limitInputPixels`(5천만 px)를 빼지 말 것 — sharp 기본값(2.7억 px)은 5MB 짜리 PNG
압축 폭탄 한 장으로 서버리스 함수를 OOM 낼 수 있는 크기다. SVG 는 받지 않는다.

프로필 사진 경로는 `user_metadata.avatar_path` 에도 들어 있는데, **그 값은 사용자가
`supabase.auth.updateUser` 로 직접 바꿀 수 있다**(닉네임과 같은 사정). 그래서
`avatarPublicUrl` 이 `{userId}/{uuid}.webp` 모양이 아니면 사진 없음으로 본다 — 이
검사를 빼면 자기 아바타 자리에 같은 스토리지 호스트의 임의 경로를 불러오게 된다.

## 3. 알림 — 실패해도 본 동작은 성공시킨다

`lib/notifications.ts` 의 `createNotification` 은 **던지지 않는다**. 부르는 자리가 전부
"댓글을 달았다" 같은 본 동작의 끝자락이라, 알림 insert 하나 때문에 댓글 등록이
실패로 돌아가면 사용자는 다시 쓰고 댓글이 두 개가 된다. 이 성질을 바꾸지 말 것.

- 알림 행은 트리거가 아니라 **사건이 일어난 서버 액션**이 만든다(actor·link 를 이미
  손에 들고 있는 쪽이 거기다).
- `title`·`preview`·`link` 는 join 하지 않고 그 시점 값을 박아둔다. 원글이 지워져도
  알림 목록이 깨지지 않아야 한다.
- 종류(`type`) 목록의 정본은 `packages/core/src/notifications.ts` 이고, DB 의
  `notifications_type_check` 제약이 같은 값을 들고 있다 — **둘을 반드시 함께 고칠 것**
  (한쪽만 고치면 알림 insert 가 조용히 실패하고, 위 규칙 때문에 아무 데도 안 남는다).
- `notifications` 는 클라이언트에 **select 만** 열려 있다. 읽음 처리·삭제도 서버 액션이
  service_role 로 한다. update 정책을 열면 RLS 가 컬럼을 가리지 못해 자기 알림의
  `link` 를 REST 로 아무 값으로나 바꿀 수 있다(그래서 화면도 `/` 로 시작하는 내부
  경로만 따라간다 — `lib/notifications.ts` 의 `safeLink`).

## 4. 집계 컬럼(comment_count·like_count)

트리거가 **매번 다시 세서** 채운다(증감이 아니다). 증감식은 한 번 어긋나면 영영
어긋난 채로 남는다(음수 댓글 수). 성능이 문제가 될 만큼 커지면 그때 인덱스를 보고
판단할 것 — 지금 구조에서는 인덱스 한 번짜리 조회다.

## 5. 새 글이 검색에 잡히려면

`/board/[id]` 는 동적 라우트라 `generateStaticParams`(한 건 이상) +
`generateMetadata` 가 함께 있어야 `<head>` 에 제목·정본이 실린다(루트 `AGENTS.md`
의 "검색 색인(SEO)" 항목). 그 둘이 기다리는 조회는 전부 `'use cache'` + 공개
클라이언트여야 한다(`lib/board.ts` 의 `getRecentBoardPostIds`·`getBoardPostMeta`).
세션 클라이언트(쿠키)를 쓰면 셸에서 통째로 빠진다.

글이 하나도 없을 때 `generateStaticParams` 가 빈 배열을 돌려주면 **빌드가 실패한다**
(Cache Components 규칙). 그래서 비었을 때는 존재하지 않는 주소 하나를 돌려준다 —
그 자리를 지우지 말 것.
