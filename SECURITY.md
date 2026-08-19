# 보안 점검 (모노레포 전체) — 2026-08-19

웹(Next.js) · 결제(토스) · Supabase(RLS·Edge Functions) · 모바일(Expo) · 운영 스크립트 · CI
전체 검토. 앱 단독 점검은 `apps/mobile/SECURITY.md` 에 따로 있다(그쪽 미결 항목은 아래
"이전 점검에서 남은 것" 참고).

상태: ✅ 이 브랜치에서 코드로 수정 · 🔧 **운영에서 사람이 해야 함** · 🟢 확인했고 문제 없음

| # | 항목 | 위험도 | 상태 |
|---|---|---|---|
| 1 | 임의 문항 주입 → 전 문제지 공식 정답표 유출 | **높음** | ✅ |
| 2 | AI 진단(유료) 요청 행을 무료 계정이 직접 생성 | **높음** | ✅ 코드 / 🔧 SQL 적용 |
| 3 | 문제를 안 풀고 출석 도장 → 멤버십 일수 환전 | 중 | ✅ |
| 4 | 작성자 이름 폴백이 이메일이라 금칙어 우회(운영진 사칭) | 중 | ✅ |
| 5 | 오픈 리다이렉트 — `next` 검사가 탭·개행으로 우회 | 중 | ✅ |
| 6 | 문항 신고 시간당 한도를 PostgREST 직접 호출로 우회 | 중 | ✅ 코드 / 🔧 SQL 적용 |
| 7 | 과목 섞어풀기가 유료 `onlyDue` 를 무검사로 수용 | 낮음 | ✅ |
| 8 | 비회원 댓글 비밀번호 무제한 대입 + 대상 식별 오라클 | 낮음 | ✅ |
| 9 | `question_memos` 길이·범위 제약 없음(저장소 소모) | 낮음 | ✅ 코드 / 🔧 SQL 적용 |
| 10 | 크론 워밍업이 사실상 무인증 공개 | 낮음 | ✅ 완화 / 🔧 `CRON_SECRET` 설정 |
| 11 | 공용 기기에서 이전 사용자의 오답노트가 다음 사용자에게 노출 | 중 | ✅ |
| 12 | `difficulty_ratings` 가 전체 사용자 UUID 를 anon 에 공개 | 낮음 | 🔧 판단 필요 |
| 13 | 의존성 취약점 (next · pdfjs-dist · sharp) | 중~높음 | 🔧 |
| 14 | 관리자 업로드가 브라우저가 준 content-type 을 그대로 사용 | 낮음 | 🔧 판단 필요 |
| 15 | CSP 헤더 없음 | 정보 | 🔧 선택 |
| 16 | 결제 · RLS · 페이월 · 채점 · 시크릿 · XSS · CI | — | 🟢 |

---

## 🔧 지금 바로 해야 하는 것 (코드 배포만으로는 안 닫힘)

1. **SQL 적용** — Supabase 대시보드 → SQL Editor 에서
   `apps/web/scripts/sql/2026-08-19-rls-hardening.sql` 실행. 전부 멱등이라 다시 돌려도 된다.
   **이걸 안 돌리면 2·6·9 는 그대로 열려 있다.** (코드 쪽은 이미 service_role 경로로
   바뀌어 있어서, SQL 을 안 돌려도 기능이 깨지지는 않는다 — 구멍만 남는다.)
2. **`CRON_SECRET` 설정** — Vercel 프로젝트 환경변수에 `openssl rand -hex 32` 값. 넣으면
   Vercel 크론이 자동으로 헤더에 실어 보내므로 크론 설정은 손댈 게 없다.
3. **의존성 올리기** — 아래 13번.
4. **이전 점검 미결** — `apps/mobile/SECURITY.md` 의 3(닉네임 트리거 SQL 적용)·4(EXPO_TOKEN 폐기).

---

## 1. 임의 문항 주입 → 전 문제지 정답표 유출 — ✅ (`f21739b`)

**위험도: 높음.** 이 서비스가 지키는 가장 값비싼 자산이 통째로 새는 경로였다.

`paper_answers` 는 "정답이 그대로 노출되면 채점 의미가 없으므로" anon/authenticated 에
select 정책을 하나도 두지 않았다(관리자 전용). 채점은 전부 service_role 경로에서만 한다.
그 전제가 서버 액션 하나로 무너져 있었다.

`createReviewFromWrong`("틀린 N문항만 다시 풀기")은 클라이언트가 보낸
`items: [{paperId, questionNumber}]` 를 검증 없이 `createReviewSessionFromItems` 로 넘기고,
그 함수는 목록을 그대로 믿고 service_role 로 세션을 만든다. 채점이 끝나면
`getReviewSessionView` 가 문항마다 `paper_answers` 를 조회해 `correctChoice` 를 실어 준다.

```
// 로그인만 하면 된다. 멤버십도, 그 문제지를 응시한 적도 필요 없다.
createReviewFromWrong({ items: [{paperId: <아무 문제지>, questionNumber: 1..50}] })
submitReviewSession({ sessionId, answers: [] })
→ view.items[].correctChoice 에 1~50번 공식 정답
```

문항 번호를 바꿔 반복하면 문제지 하나가 통째로, `exam_papers` 는 public read 라 UUID 를
누구나 얻으므로 문제지를 바꿔 가며 반복하면 3,800여 장 전체가 빠져나간다.

**조치**: 클라이언트가 보낸 목록은 `filterQuestionsAnsweredByUser` 를 통과해야 세션이
된다 — `user_question_status` 에 있는, 그 사용자가 실제로 풀어 본 문항만 남는다. 그 문항을
풀려면 CBT 를 실제로 응시해야 하고(서버가 시작 시각을 기록하고 최소 응시시간을 강제),
자기가 푼 문항의 정답을 보는 건 이 기능의 원래 목적 그대로다. 조회는 사용자 세션
클라이언트로 한다 — `user_question_status` 가 select-own RLS 라 스코프가 자동으로 본인
행에 묶인다. `createReviewSessionFromItems` 머리말에 "이 함수는 items 를 검증하지 않는다 —
사용자 입력은 반드시 먼저 거를 것"을 못 박았다. 회귀 테스트: `review-from-wrong.test.ts`.

앱(Edge `review-create`)은 문항을 서버가 뽑으므로 같은 경로가 없다.

## 2. AI 진단 요청 행 무단 생성 — ✅ 코드 / 🔧 SQL (`9872b78`)

AI 약점 진단은 유료 기능인데 페이월이 애플리케이션에만 있었다(웹 `requestDiagnosis` 의
`isPremium`, 앱 `ai-diagnose` 의 `isPremiumUser`). `ai_diagnoses` 의 INSERT 정책은
`auth.uid() = user_id and report is null` 뿐이라 멤버십도 자격(오답 15개/응시 3회)도 안 본다.

```
POST /rest/v1/ai_diagnoses {"user_id":"<내 uid>","diagnosis_date":"…","report":null}
```

리포트 생성 배치(`scripts/next-diagnosis.mjs`)가 `report is null` 인 가장 오래된 행을
멤버십 확인 없이 집어 Claude 로 채워 주고, select-own 정책으로 그대로 읽힌다. `diagnosis_date`
에 제약이 없어(유니크는 `(user_id, diagnosis_date)` 뿐) 날짜만 바꿔 수백 행을 밀어 넣으면
생성 대기열을 점유해 정상 유료 회원의 진단을 지연시킬 수도 있다.

**조치**: insert 정책 제거 + insert 권한 회수. 요청 행 생성도 service_role 몫으로 옮겼다
(웹 `requestTodayDiagnosis`, 앱 Edge Function — 둘 다 멤버십을 먼저 확인한다). select 정책은
유지(본인 리포트는 클라이언트가 직접 읽는다).

> 배치(`next-diagnosis.mjs`)에 멤버십 재확인은 **일부러 넣지 않았다.** 요청 시점엔 유료였다가
> 생성 시점에 만료된 사용자의 행이 영구히 건너뛰어지면, 그 행이 "일 1회" 슬롯을 잡은 채
> 남아 정상 사용자가 그날 진단을 영영 못 받는다. 구멍은 입구에서 막는 게 맞다.

## 3. 출석 도장 → 멤버십 환전 — ✅ (`c985f66`)

출석은 장식이 아니라 돈이다 — `grant_attendance_membership` 이 단계(5·10·15·20·25일)마다
`memberships.expires_at` 을 실제로 민다(월 최대 6일). 그런데 판정 기준이 **채점된 문항 수**라
답을 하나도 안 골라도 세션 문항 수만 채우면 도장이 찍혔다. 섞어풀기 경로에는 최소 소요
시간 하한도 아예 없다(CBT 는 서버 기록 시작 시각으로 90초를 강제).

```
POST /functions/v1/review-create  {"limit":20}
POST /functions/v1/review-submit  {"sessionId":"…","answers":[]}   # 1초 미만, 답안 없음
```

매일 돌리면 결제 없이 매달 프리미엄 6일. CBT 경로도 90초만 기다리면 같은 일이 된다.

**조치**: 세는 단위를 "채점된 문항"에서 **답을 고른 문항**으로 바꾸고, 세션이 너무 빨리
끝났으면(문항당 2초 미만) 세지 않는다. 경과 시간은 서버 기록(`review_sessions.created_at` /
`cbt_attempt_starts.started_at`)으로만 잰다. 하한에 걸려도 **채점은 그대로 한다** — 출석만
남기지 않는다(여기서 채점을 막으면 조금 빠른 진짜 사용자의 답안이 사라진다).
규칙 정본은 `packages/core` 의 `attendanceQuestionCount`, Deno 사본은 `_shared/attendance.ts`.
네 곳(웹·앱 × CBT·섞어풀기)을 함께 고쳤다.

## 4. 작성자 이름 폴백 → 운영진 사칭 — ✅ (`20887b6`)

댓글·건의에 박히는 작성자 이름이 `user_metadata.nickname ?? email.split("@")[0] ?? "회원"`
이었다. 그 이메일 로컬파트는 닉네임 정책을 **한 번도 통과하지 않는다** — 정책을 강제하는 DB
트리거(`sync_nickname_from_auth`)는 `user_metadata` 가 바뀔 때만 도는데, 닉네임을 설정한 적
없는 계정(소셜 로그인 후 온보딩을 건너뛴 경우)은 그 트리거를 지나간 적이 없다.

`관리자@…` 로 가입해 닉네임을 설정하지 않으면 금칙어 목록(admin·관리자·운영자…)을 건너뛴
"관리자"가 공개 댓글에 붙는다. `<피해자닉네임>@…` 이면 `profiles` 의 `lower(nickname)`
유니크 인덱스도 우회해 특정 사용자와 같은 이름으로 글을 쓸 수 있다. 덤으로 이메일 로컬파트는
개인정보인데 공개 글에 박혔다.

**조치**: 이메일 폴백 제거, 중립 기본값("회원"). 정본은 `packages/core` 의 `authorNickname`,
Deno 사본은 `comments-write`. 화면 표시 전용 자리(헤더·마이페이지)는 본인에게 본인 이름을
보여주는 것이라 그대로 뒀다.

## 5. 오픈 리다이렉트 — ✅ (`679dcfc`)

`sanitizeNextPath` 는 `//` 로 시작하는지를 **원본 문자열**에서 봤는데, URL 파서(WHATWG)는
파싱 전에 탭·개행을 먼저 지운다. 검사한 문자열과 실제로 파싱되는 문자열이 달라졌다.

```
next=/%09/evil.com → 검사 통과 → new URL(...) 이 탭을 지워 //evil.com → https://evil.com
```

도달 경로: `/auth/callback` 의 `next`(소셜 로그인을 정상적으로 마친 사용자가 마지막에 외부
도메인으로 튕긴다 — "우리 도메인이 준 링크"라는 신뢰가 남의 화면에 붙는다), `updateNickname`
의 `formPath`/`successPath`, `/login`·`/onboarding/nickname`·`/membership` 의 `next`.

**조치**: 파서가 지울 문자를 먼저 지운 뒤 검사하고 반환도 지운 값으로 해서 "검사한 문자열 =
파싱될 문자열"이 되게 했다. 회귀 테스트는 문자열이 아니라 `new URL(...).origin` 을 검사한다.

## 6. 문항 신고 한도 우회 — ✅ 코드 / 🔧 SQL (`9872b78`)

서버 액션은 시간당 20건·문항 번호 300 상한을 확인하지만 INSERT 는 사용자 세션 클라이언트로
나가고 RLS 는 `auth.uid() = user_id` 만 본다. PostgREST 를 직접 부르면 두 상한 모두 평가되지
않고, 배열 본문으로 한 요청에 수천 행을 넣을 수 있다(유니크 부분 인덱스는 문항 번호만 바꾸면
계속 통과). 계정 하나로 `/admin/reports` 를 못 쓰게 만들 수 있다.

**조치**: insert 정책 제거 + 권한 회수, 접수는 service_role 로. 문항 번호 CHECK 추가.

## 7. 과목 섞어풀기의 `onlyDue` 무검사 — ✅ (`c985f66`)

전 과목판 `createReviewAll` 은 유료 전용 `onlyDue`(복습=간격 반복)에 `isPremium` 을 걸어
두었는데 과목판 `createReviewSession` 에만 빠져 있었다. 화면 요청에 `onlyDue: true` 만 붙이면
무료로 열렸다. 얻는 것은 복습 필터에 한정되고 해설은 실리지 않아 낮음.

## 8. 비회원 댓글 비밀번호 대입 — ✅ (`6c82955`)

레거시 비회원 댓글의 수정·삭제는 **세션 없이** 비밀번호 문자열 하나로 통과하는데 시도 제한이
없었다. `comments` 는 public read 라 로그인 없이 `user_id` 가 null 인 댓글 id 를 골라낼 수
있다. 요청 한 번에 bcrypt 비교 한 번이라 인증 없이 서버 CPU 를 태우는 증폭 경로이기도 했다.
게다가 실패 문구가 "권한이 없어요"와 "비밀번호가 일치하지 않아요"로 갈려 대입 대상을
알려줬다.

**조치**: 댓글 단위 10분 5회 제한(검사는 bcrypt **앞에** — 뒤에 두면 한도 초과 요청도 해시
비용을 그대로 치른다), 실패 문구 통일. 유량 제한기는 `webhook-guard` 에서 `lib/rate-limit.ts`
로 옮겨 재사용(webhook-guard 가 재수출하므로 기존 import 는 그대로).

## 9. `question_memos` 값 범위 — ✅ 코드 / 🔧 SQL (`9872b78`)

`comments`(1~2000자)·`suggestions`·`question_reports.message`(500) 에는 DB 제약이 있는데 자유
텍스트인 `memo` 에만 없었다. 길이 제한은 애플리케이션에만 있고(웹 `slice(0, 2000)`, 앱은
자르지도 않는다) PostgREST 로 우회된다. 기본키가 `(user_id, paper_id, question_number)` 이고
문항 번호 범위 제약도 없어 계정 하나로 수 MB 짜리 행을 사실상 무한히 만들 수 있었다.

**조치**: 길이·문항 번호 CHECK. 이 테이블은 웹·앱이 모두 사용자 세션으로 쓰고 담기는 값이
권한이 되지 않으므로 클라이언트 직접 쓰기는 유지했다. `wrong_note_marks` 도 같이 정리.

## 10. 크론 워밍업 — ✅ 완화 / 🔧 설정 (`ba6f74f`)

`/api/cron/warm` 은 `CRON_SECRET` 이 설정돼 있을 때만 인증한다. 그런데 그 값이
`.env.local.example` 에 없어서 있는 줄 모르면 설정되지 않고, 그 상태에서 무인증 공개다.
경로는 `vercel.json` 에 적혀 있고 지오블록도 `/api/**` 를 통과시킨다. 한 번마다 서버리스
함수 1회 + Supabase 쿼리 1회가 과금된다(새는 데이터는 없고 비용·가용성 문제).

**미설정을 막지는 않았다** — 여기서 거절하면 이 엔드포인트의 존재 이유인 "Supabase 자동
일시정지 방지"가 조용히 죽는다. 대신 켜는 비용을 없앴다: `.env.local.example` 에 생성 명령과
함께 항목 추가(+ `TOSS_WEBHOOK_IPS`, `GEO_BLOCK*` 도 같이), 토큰 비교를 상수시간으로.

## 11. 공용 기기의 오답노트 캐시 유출 — ✅ (`54087b5`)

설정 화면의 로그아웃이 `signOut()` 을 기다리지 않고 곧바로 마이페이지로 넘어가는데,
`signOut` 은 **캐시를 먼저 지우고 세션을 나중에** 끊었다. 그 사이 마이페이지가 포커스를
받아 `if (!session) return;` 을 통과하고(아직 유효하다) 오답노트를 다시 조회해, 방금 지운
자리에 개인 데이터를 다시 써 놓는다.

오프라인 캐시 키가 사용자별로 나뉘어 있지 않아서(`wrong-notes` 하나), 같은 기기에서 다음
사람이 로그인한 뒤 오프라인으로 열면 `fetchWithCache` 가 조회 실패 → `readCache` 폴백으로
이전 사용자의 과목·문제지 제목·문항번호·점수·극복 여부를 그대로 그린다. 루팅 없이 앱 UI
만으로 남의 학습 이력이 보인다.

**조치**: (1) 세션을 먼저 끊고 캐시를 나중에 지우도록 순서 반전, (2) `signOut` 을 기다린 뒤
화면 전환, (3) 개인 캐시 키에 사용자 id 를 넣어 파일이 남아 있어도 다른 계정에서는 열리지
않게. 키를 만들 때 `getUser()`(네트워크 호출) 가 아니라 `getSession()`(로컬 SecureStore)을
쓴다 — 정작 이 캐시가 필요한 오프라인에서 먼저 실패하면 안 된다.

## 12. `difficulty_ratings` 가 사용자 UUID 를 공개 — 🔧 판단 필요

`create policy "public read ratings" ... using (true)` 이고 `comments` 와 달리 컬럼 단위
grant 가 없어, `user_id` 가 anon 에게 그대로 열려 있다. 앱 번들에서 추출한 anon 키만으로
로그인 없이

```
GET /rest/v1/difficulty_ratings?select=user_id,paper_id,score
```

전체 사용자 UUID ↔ 문제지 ↔ 평점 매핑을 덤프할 수 있고, `comments` 는 anon 에게
`user_id`·`nickname` 을 명시적으로 허용하므로 UUID ↔ 닉네임 대응표까지 만들 수 있다.
"닉네임 X 가 어떤 급수·직렬을 준비하는가" 수준의 프로파일링이 가능하다.

**고치지 않았다 — 결정이 필요하다.** `comments` 처럼 컬럼 grant 를 좁히는 게 정석이지만,
Postgres 는 `WHERE` 절에 쓰는 컬럼에도 SELECT 권한을 요구한다. 지금 웹·앱 모두 "내 평점"을
`user_id` 로 찾으므로(`apps/mobile/src/lib/paper-detail.ts` 는 전체 행을 받아 클라이언트에서
`find` 까지 한다) 컬럼을 잠그면 그 경로가 같이 깨진다. 제대로 하려면 평균·표본수는
`avg_score_by_round` 처럼 `security definer` 함수로 내주고 행 조회는 본인 것만 열어야 하는데,
표시 로직까지 손대는 변경이라 앱을 띄워 확인할 수 있는 자리에서 하는 게 맞다고 봤다.

## 13. 의존성 — 🔧

`npm audit` 기준 critical 1 / high 30. 대부분 Expo CLI 빌드 툴체인(런타임 노출 없음)이지만
아래 셋은 프로덕션 직접 의존이다.

| 패키지 | 현재 | 권고 | 내용 |
|---|---|---|---|
| `next` | 16.2.9 | **16.3.1** (minor, 비파괴) | 미들웨어/프록시 우회, 서버액션 SSRF·DoS, 캐시 혼동 등 |
| `pdfjs-dist` | 6.1.200 | **≥ 6.2.108** | 악성 PDF 열람 시 임의 JS 실행 |
| `sharp` | 0.34.5 | 0.35.3 (semver major) | libvips CVE 4건 |

`pdfjs-dist` 의 실제 노출도는 낮다 — 렌더하는 PDF 가 관리자 업로드본뿐이다
(`papers/[id]/cbt/page.tsx` → Storage public URL). `next` 는 이 앱이 프록시(미들웨어)를
쓰므로 우선순위가 가장 높다. **이 브랜치에서는 올리지 않았다** — 프레임워크 minor 업그레이드는
빌드·실동작 확인이 따라야 하는데 여기서는 실제 앱을 띄워 확인할 수 없어, 검증 없이 밀어넣는
쪽이 더 위험하다고 판단했다.

## 14. 관리자 업로드 content-type — 🔧 판단 필요

`uploadExamPaper` 가 `contentType: file.type || "application/pdf"` 로 **브라우저가 준 값**을
그대로 쓴다. `optimizePdf` 는 파싱 실패 시 원본 버퍼를 그대로 통과시키므로, 비-PDF 바이트가
공개 버킷에 임의 content-type 으로 저장될 수 있다. 관리자 전용이고 스토리지 도메인은
`gongmoa.kr` 과 다른 오리진이라 쿠키 탈취로 이어지지 않아 낮음. 경로가 항상 `.pdf` 이고 행도
PDF 로 다루므로 `"application/pdf"` 로 고정하는 게 맞다고 본다 — 다만 관리자 신뢰 경계 안이라
판단을 남겨둔다.

## 15. CSP — 🔧 선택

`next.config.ts` 에 `X-Content-Type-Options`·`X-Frame-Options`·`Referrer-Policy`·
`Permissions-Policy` 는 있는데 `Content-Security-Policy` 가 없다. 현재 XSS 싱크는 전부
안전하지만(아래 🟢) 심층 방어로 권장. HSTS 는 Vercel 이 붙인다.

---

## 🟢 확인했고 문제 없음

읽고 실제로 확인한 것만 적는다.

**결제(토스)** — 이 코드베이스에서 가장 잘 방어된 부분이다.
- 웹훅은 **본문을 믿지 않는다**. `paymentKey` 만 꺼내 토스에 다시 물어보고 그 응답만
  진실로 취급한다. 위조된 "결제 완료" JSON 으로는 멤버십을 못 받는다.
- 승인 금액은 항상 **DB 의 값**(`decideSettlement`). 리다이렉트 쿼리의 `amount` 는 대조에만
  쓴다 — 5,900원짜리를 100원에 파는 경로가 없다.
- 멱등: `apply_paid_membership` 이 행 잠금으로 처리(리다이렉트와 웹훅이 겹쳐도 한 번만).
  토스 호출에도 `Idempotency-Key`.
- 멤버십은 세션 사용자가 아니라 **주문에 적힌 `payments.user_id`** 에게 간다 — 남의 orderId 로
  successUrl 을 열어도 얻는 게 없다.
- 시크릿 키는 `server-only`, ck/sk 쌍·test/live 모드 불일치를 감지하면 결제를 아예 안 연다.
- 무료 체험은 `start_trial_if_eligible` 하나로만 켜지고, 탈퇴 후 재가입은 이메일 해시 원장
  (`trial_consumptions`, `auth.users` FK 없음)으로 막힌다.

**RLS / 스키마** — `SECURITY DEFINER` 함수 전부 `set search_path` 고정. 민감 RPC
(`apply_paid_membership`·`start_trial_if_eligible`·`record_attendance_day`·
`grant_attendance_membership`)는 `public/anon/authenticated` 에서 revoke 하고 service_role
에만 grant. `memberships`·`payments`·`user_question_status` 는 쓰기 정책 없음.
`suggestions`·`suggestion_comments`·`trial_consumptions`·`explanation_*`·`review_sessions` 는
정책 0개 = 전면 차단. `comments` 는 컬럼 단위 grant 로 `password_hash`·`ip_address` 비노출.

**페이월** — 해설 본문을 서버가 **아예 안 내려보낸다**(CSS 로 가리는 방식이 아님). 웹
(`papers/[id]/explanations`)·Edge(`explanations-get`) 양쪽 확인. 개발자도구로 블러를 걷어내도
볼 것이 없다.

**채점 무결성** — 정답은 RLS 로 클라이언트 차단, 채점은 전부 service_role. 점수·정오는 서버가
계산하고 클라이언트가 보낸 값을 안 쓴다. 최소 응시시간은 서버 기록 기준, 제출 후 시작 기록을
지워 replay 차단. 세션 소유권은 `session.user_id !== userId` 로 확인.

**서버 액션 전수 확인** — 익명 허용은 `login`/`signIn*`/`signOut` 뿐. userId 를 인자로 받는
액션 없음. `createAdminClient()` 사용처 49곳 전부 인가 선행 확인. 관리자 액션은 전부
`requireAdmin`(세션 + `is_admin()` RPC) + RLS 이중.

**XSS** — `dangerouslySetInnerHTML` 은 두 곳뿐: `json-ld.tsx`(`<` → `<` 이스케이프),
`layout.tsx`(테마 초기화, 사용자 입력 없는 정적 문자열). 지오블록 화면도 국가 코드를
`[^A-Z]` 로 거른다. 나머지는 React 기본 이스케이프.

**시크릿 / CI** — 커밋된 키 없음(`.env*` 는 gitignore, 예시만 추적). 모바일 세션 토큰은
SecureStore(Keychain/Keystore). `app.json` 의 카카오 키는 네이티브 앱 키라 공개 전제.
워크플로는 `workflow_dispatch`/`schedule` 전용이고 입력은 `choice` 로 제한 — 스크립트 인젝션
경로 없음, 시크릿 echo 없음.

**주입** — 스크립트의 `child_process` 는 `execFileSync`(배열 인자) 한 곳뿐. PostgREST `.or()`
에 사용자 입력을 보간하는 곳 없음(검색은 JS 필터). 업로드 경로는 `crypto.randomUUID()`.

**요청 출처 / 리다이렉트** — `getRequestOrigin` 은 아는 호스트(정본·`www`·프리뷰·로컬)만
그대로 쓰고 나머지는 정본으로 되돌린다. 호스트 헤더 인젝션으로 결제 successUrl·로그인
redirectTo 를 남의 도메인으로 돌릴 수 없다.

---

## 이전 점검에서 남은 것 (`apps/mobile/SECURITY.md`)

- **3. 닉네임 트리거 SQL 적용** 🔧 — `schema.sql` 의 "닉네임 서버 강제" 절을 운영 DB 에
  적용해야 한다. 위 4번(작성자 이름 폴백)은 이 트리거가 **적용돼 있다는 전제**에서 남은
  구멍을 막은 것이라, 트리거 자체가 아직이면 그쪽이 먼저다.
- **4. EXPO_TOKEN 폐기** 🔧 — 노출된 토큰 revoke 후 재발급.
- **5. Google·Kakao nonce** ⛔ — SDK 미지원(Apple 만 적용됨).
