<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 작업별 상세 규칙은 docs/agents/ — 해당 작업 시작 전 반드시 Read

이 파일은 "절대 어기면 안 되는 금지선"만 담은 인덱스다. 아래 표의 작업에 손대기
전에 **대응 문서를 Read 도구로 먼저 읽을 것** — 각 문서는 실제 사고를 겪고 쓴
절차·원인·복구 방법이라, 안 읽고 작업하면 같은 사고가 재발한다.

| 작업 | 먼저 읽을 문서 |
|---|---|
| 문항 이미지 크롭 (`crop-question-images.mjs`/`batch-crop-questions.mjs`, 새 시험유형 등록 포함; **텍스트 레이어 없는 스캔본**은 `crop-scanned-questions.mjs` — 같은 문서 맨 위 "스캔본 크롭 절차" 절) | `docs/agents/crop-question-images.md` |
| 해설 배치 루틴·해설 스크립트·해설 관련 RLS/스키마 (`next-explanation-chunk.mjs`, `save-explanations.mjs`, 루틴 프롬프트/훅) | `docs/agents/explanation-batch-routines.md` |
| 법령 문항 해설 (생성·재생성·삭제·판별) | `docs/agents/law-explanations.md` |
| 중복 시험지 표시 통합 (`dedup-papers.ts`, 목록에 같은 시험지가 여러 장 보이는 문제) | `docs/agents/dedup-papers.md` |
| 정답 등록·검수 (`extract-answer-keys.mjs`, `list-pending-answer-keys.mjs`, `paper_answers` 직접 조작) | `docs/agents/answer-keys-tracks.md` |
| 통합본 PDF 과목별 분리 (`split-by-toc.mjs`/`split-combined-pdf.mjs`/`split-by-subject-header.mjs`) | `docs/agents/split-combined-pdfs.md` |
| 복습 스케줄(SRS) 상수 조정 (`packages/core/src/srs.ts`, 학습 단계·ease·leech·연체 점수) | `docs/agents/srs-tuning.md` |
| 개념 사전 정리 (`keyword_title` 정본화, `concepts`/`concept_aliases`, 약점 진단 축, 재분류 배치 `next-concept-chunk.mjs`/`save-concepts.mjs`) | `docs/agents/concept-dictionary.md` |
| 해외 IP 차단 (`geo-block.ts`, `proxy.ts`, `GEO_BLOCK*` 환경변수, 크롤러 예외) | `docs/agents/geo-block.md` |
| 과목명 표기 (시행처마다 다른 과목명, `subject-label.ts`, `SUBJECT_ALIASES`, 새 과목 행 추가) | `docs/agents/subject-names.md` |
| 자유게시판 본문(HTML)·이미지 업로드·알림 (`rich-text.ts` 새니타이저, `board/actions.ts`, `notifications`, `avatars`/`board-images` 버킷) | `docs/agents/board-rich-text.md` |
| 한국사능력검정시험(한능검) 회차 추가·전용 과목/탭 (`upload-korean-history-exam.mjs`, `lib/korean-history-exam.ts`) | `docs/agents/korean-history-exam.md` |
| 광고(구글 애드센스) — 게시자 ID, `<head>` 로더, `/ads.txt`, 광고 관련 개인정보 고지 | `docs/agents/adsense.md` |
| Edge Function 용 core 번들 (`packages/core/scripts/bundle-edge.mjs`, `supabase/functions/_shared/core.mjs` 재생성, `packages/core/src/rules/*` 신설·이동, 옛 `_shared/srs.ts` 동시수정 규칙의 후신, Edge 응답 "추가만") | `docs/agents/edge-core-bundle.md` |
| 계약 테스트 (웹 어댑터 ↔ Edge Function 결과 행 비교, `contract-tests.yml`, 픽스처 `rules/__fixtures__/`, `now`/`fuzz` 주입) | `docs/agents/contract-tests.md` |
| 모바일 파리티 (웹에 기능 추가 시 규칙→core·서버 액션↔Edge/RPC 어댑터·계약 테스트·매트릭스 절차, 앱이 절대 하지 않는 것) | `docs/agents/mobile-parity.md` |

# 금지선 (문서 안 읽었어도 이것만은 절대)

- **크롭**: 배치 스크립트를 한 번 돌리고 성공/실패 개수만 보고 끝내지 말 것.
  "개수 일치 = 성공"으로 판단 금지 (반쪽 크롭이 개수만 맞은 실측 사례 있음).
  크롭 로직 수정 시 이미 완료한 다른 시험유형/급수 전체 재검증 필수.
  **스캔본(OCR 경로)은 더하다**: 개수·번호 대조 게이트가 50/50 이어도 발문 유실·세트
  자료 누락·머리글 끼임은 못 잡는다(실측 4종) — `dump-scanned-crops.mjs` 병합본을
  회차마다 끝까지 눈으로 본 뒤에만 올릴 것. 되풀이 꼬리말 판정을 스캔본에서 다시 켜지
  말 것(⑤가 잘린다).
- **해설 배치**: 레포의 `scripts/` 해설 스크립트 사본을 Supabase Storage에 업로드
  금지 (배포는 소유자 전용 절차). `question_explanations_question_uidx` unique
  인덱스 삭제 금지 (upsert 전제조건). `question_explanations` RLS/`admins` 변경 시
  해설봇 계정 쓰기 권한 유지 확인 필수. 제외 과목은
  `explanation_excluded_subjects` 테이블로만 제어 — 스크립트 수정 아님.
- **법령 해설**: 정답 번호는 언제나 출제 당시 공식 정답 유지 (현행법 반영은
  `current_answer_status` 등 메타로만). 법 문항 판별을 keyword 정규식으로 하지
  말 것.
- **dedup**: 목록의 카드 병합은 버그가 아님 — 표시 로직을 되돌리거나 중복으로
  보이는 `exam_papers` 행을 삭제하지 말 것.
- **SRS 상수**: 실측(`npm run retention-report`) 없이 간격·ease·leech 상수를 바꾸지
  말 것. 정본은 `packages/core/src/srs.ts` 하나다 — 고친 뒤 반드시
  `npm run bundle-edge -w @gongmoa/core` 로 `supabase/functions/_shared/core.mjs` 를 재생성해
  같은 커밋에 넣을 것 (번들이 낡으면 웹과 앱의 복습일이 조용히 어긋난다;
  `bundle-edge:check` 가 PR 게이트). Edge 안에 SRS 상수를 따로 쓰지 말 것.
- **개념 사전**: `keyword_title` 원본을 UPDATE 하지 말 것 (화면에 그대로 보여주는
  값 — 정리 결과는 `concept_id` 축으로만). 개념 id 재발급 금지, 삭제 대신
  `merged_into`. 미매칭을 "기타"로 뭉치지 말 것.
  `normalizeConceptAlias` 는 세 곳에 있다 (루틴 환경은 plain node라 TypeScript
  패키지를 import 못 한다): `packages/core/src/concept-dictionary.ts`(원본),
  `apps/web/scripts/save-explanations.mjs`(해설 배치),
  `apps/web/scripts/lib/concept-alias.mjs`(재분류 배치) — **반드시 함께 고칠 것**.
  하나만 고치면 경로에 따라 같은 문항에 다른 개념이 붙는다.
  재분류 배치는 이미 붙은 `concept_id`를 덮어쓰지 말 것 (재실행 시 개념이 흔들리면
  진단 이력이 깨진다).
- **무료 체험 시작**: `memberships` 를 직접 UPDATE 해서 체험을 켜지 말 것 — 반드시
  `start_trial_if_eligible` RPC 하나만 쓸 것(웹·앱 양쪽). 그 함수가 탈퇴 후 재가입인지를
  `trial_consumptions` 원장으로 함께 보는데, 예전처럼 각자 UPDATE 를 날리면 한쪽에서만
  체험이 다시 켜진다. `trial_consumptions` 에 `auth.users` FK 를 걸지 말 것 (탈퇴 때
  같이 지워져 원장이 무의미해진다). 이메일 정규화는 소문자·공백까지만 (그 이상 묶으면
  남남인 신규 가입자의 체험을 뺏는다).
- **해외 IP 차단**: 크롤러 예외(`CRAWLER_UA`)를 좁히지 말 것 — Googlebot·Bingbot 은
  미국 IP 에서 오므로, 예외가 빠지면 403 이 계속 나가 색인이 통째로 사라진다.
  `/payments/**`·`/auth/**`·`/api/**` 를 차단 대상에 넣지 말 것 (결제 승인
  리다이렉트를 막으면 돈만 빠진 주문이 남는다). 국가를 모를 때는 언제나 통과시킬 것.
- **검색 색인(SEO)**: `next.config.ts` 의 `htmlLimitedBots` 에 Googlebot 을 넣지 말 것 —
  Vercel 이 Googlebot 에는 캐시 우회를 적용하지 않아, 넣는 순간 Googlebot 이 받는
  HTML 에서 `<title>`·canonical 이 통째로 사라진다(2026-08-28 색인 ~650 → 83 의 원인).
  `partialPrefetching: true` 를 끄지 말 것 — 문제지 4,300장 대부분은 빌드에 안 실리고
  첫 방문 뒤 승격으로 `<head>` 에 메타데이터를 얻는다. 동적 라우트를 새로 만들면
  `generateStaticParams`(한 건 이상) + `generateMetadata` 가 쓰는 조회는 전부
  `'use cache'` + 공개 클라이언트로 둘 것(`searchParams`·`cookies()` 를 읽으면 셸에서
  빠진다). 확인은 UA 를 Googlebot 으로 바꿔 받은 HTML 의 `<head>` 를 직접 볼 것
  (GitHub Actions "크롤러 head 점검"이 매일 같은 검사를 한다).
  사이트맵은 `/sitemap.xml`(인덱스) + `/sitemap-hubs.xml` + `/sitemap-papers-<시험>.xml`
  로 나뉜다(`lib/sitemap-data.ts`) — 다시 한 파일로 합치지 말 것(서치콘솔에서 시험별
  색인 현황을 보려는 것). **하위 파일을 디렉터리 밑으로 내리지 말 것** — 사이트맵은
  자기가 놓인 경로 아래의 주소만 담을 수 있고, 구글은 그 제한을 서치콘솔 직접 제출에만
  면제한다(robots.txt 에 적는 것으로는 안 풀린다). 2026-09-06 에 `/sitemaps/` 밑으로
  내렸다가 담긴 주소가 한 건도 인정되지 않아, 사이트맵이 내주는 4,760 URL 중 구글이
  아는 것이 1,559 로 주저앉았다. 루트 주소는 `next.config.ts` 의 rewrite 가 라우트로
  넘긴다. robots.txt 에는 인덱스 한 줄만 적는다(DB 를 읽게 만들지 말 것). 문제지 카드·상세 링크에 `?level=` 같은 파라미터를 다시 붙이지
  말 것(변형 URL 이 문제지마다 생겨 "대체 페이지"만 쌓인다). 배포 뒤에는
  `/api/cron/warm-papers` 를 **끝까지** 돌릴 것(`CRON_SECRET` 필수) — 승격 전 공용 셸을
  크롤러가 먼저 받지 않게 하려는 것. 한 호출이 전부를 돌지 않는다: 응답의 `next` 가
  null 이 될 때까지 `?offset=<next>&chain=0` 으로 이어 부른다(라우트 머리 주석에
  PowerShell 루프). 확인은 미승격 문제지 하나를 크롤러 UA 로 받아
  `x-vercel-cache` 와 `<head>` 길이를 보는 것 — 승격 전 PRERENDER·headLen 1766·
  title/canonical 0개, 승격 후 HIT·headLen 4084·각 1개(2026-09-06 실측).
- **다운로드 집계**: `download-counting.ts` 의 봇 목록(`NON_HUMAN_UA`)에 `naver`·`daum`·
  `kakaotalk` 을 넣지 말 것 — 셋 다 크롤러가 아니라 **인앱 브라우저**의 UA 표식이라
  (`NAVER(inapp;...)`, `KAKAOTALK 10.x`, `DaumApps/...`) 넣는 순간 국내 모바일 유입이
  통째로 집계에서 사라진다. 각 사의 크롤러 이름은 따로다(Yeti·Daumoa·kakaotalk-scrap).
  같은 이유로 `geo-block.ts` 의 `CRAWLER_UA` 를 여기서 재사용하지 말 것 (그쪽은 넓을수록
  안전한 목록이고 여기서는 넓으면 사람을 지운다). 판정이 false 여도 파일은 내줄 것 —
  이건 집계 장치지 접근 통제가 아니다.
- **과목명 표기**: 시행처가 과목을 다르게 부른다고(군무원 "행정법" ↔ 국가직
  "행정법총론") `subjects` 에 과목 행을 새로 만들지 말 것 — 개념 사전이 과목 단위라
  사전 복제와 `concept_id` 재발급이 따라온다. 표시 이름만
  `packages/core/src/subject-label.ts` 에서 되돌린다. `exam_papers.title` 을 UPDATE
  로 고치지 말 것 (업로드 시점 기록).
- **자유게시판 본문**: 클라이언트가 보낸 HTML 을 `board_posts.content_html` 에 그대로
  넣지 말 것 — 반드시 `sanitizeRichText`(packages/core/src/rich-text.ts)를 통과시킨
  결과만 저장한다(순서도 새니타이즈 → 검증 → 저장). 화면에서
  `dangerouslySetInnerHTML` 을 쓰는 곳은 `components/rich-text-content.tsx` 하나로
  유지할 것. 새니타이저의 허용 목록(태그·속성·style 값)을 넓히는 것은 기능 추가가
  아니라 공격면 확대다 — 테스트를 함께 넣지 않고 넓히지 말 것.
  `avatars`·`board-images` 버킷에 쓰기 정책을 열지 말 것 (업로드는 서버 액션이
  리사이즈·형식 변환을 강제하는데, 직접 올릴 수 있으면 그 강제가 사라진다).
  알림 종류는 `packages/core/src/notifications.ts` 와 DB 의
  `notifications_type_check` 두 곳에 있다 — 반드시 함께 고칠 것.
- **클라이언트 컴포넌트에 함수 prop 금지**: 서버 컴포넌트에서 `"use client"` 컴포넌트로
  함수를 넘기지 말 것(`hrefFor={...}` 같은 것). prop 은 직렬화돼 넘어가므로 렌더가
  통째로 던지는데, **그 에러는 셸이 나간 뒤 스트림 안에서 터져 HTTP 상태가 200 으로
  남는다** — `curl -o /dev/null -w "%{http_code}"` 로는 멀쩡해 보이고 화면만 죽는다
  (2026-09-05 `/mix` 사고, 하루치 배포가 그 상태였다). 주소·문구 조립은 필요한 값만
  문자열로 넘기고 컴포넌트 안에서 한다. 배포 확인은 상태 코드가 아니라 **본문에
  `digest\":` 가 있는지**로 볼 것: `curl -s <url> | grep -o 'digest[^,]*'`.
- **한능검**: 한국사능력검정시험 문제지를 공무원 "한국사"(`korean-history`) 과목 행에
  붙이지 말 것 — 전용 과목 행(`korean-history-exam`)에만 붙인다. 50문항 5지선다라
  20~25문항짜리 공무원 한국사 목록에 섞이면 그 과목이 통째로 못 쓰게 된다.
- **광고**: 자동 광고에서 **CBT 풀이 화면(`/papers/*/cbt`)·복습 세션을 제외**할 것
  (애드센스 대시보드 설정) — OMR 버튼 위 오클릭은 무효 트래픽이 되고, 무효 트래픽은
  경고 없이 계정 정지로 이어진다. 자기 광고 클릭 금지(테스트로도).
  게시자 ID 정본을 환경변수로 옮기지 말 것 (`lib/adsense.ts` 상수 — 값이 비면 광고가
  조용히 멈추고 `/ads.txt` 가 404 가 된다). `/ads.txt` 를 정적 파일로 다시 만들지 말 것
  (ID 가 두 곳에 나뉘어 적힌다). 로더를 `next/script` 로 바꾸지 말 것 (심사 크롤러가
  서버 HTML 에서 태그를 찾는다).
  **자동 광고를 켜면 멤버십 회원에게도 광고가 나간다** — 광고 노출은 코드
  (`lib/ads.ts` + `components/ad-banner.tsx`)가 손으로 배치한 자리에서만 판정하므로,
  대시보드의 자동 광고는 그 판정을 지나쳐 결제 회원·관리자 화면에도 광고를 꽂는다
  (관리자에게 꽂히면 자기 광고 클릭 사고로 이어진다). 자동 광고는 꺼 둘 것.
- **정답 등록**: `question_count`와 길이가 다른 정답 배열을 덮어쓰지 말 것.
  공통과목이라고 정답을 다른 직류(track) 문제지에 수동 복사하지 말 것 (법원직
  서기보는 국어·한국사 15문항/영어 20문항 별도 문제지 — 실측 사고 있음).
  전항정답/복수정답/정답없음은 `voided_questions`로 처리.
- **모바일 파리티**: 규칙은 `packages/core/src/rules` 한 곳에만 쓸 것 — 웹 서버 액션과
  Edge Function 은 그 규칙을 부르는 어댑터다(둘 중 한쪽에만 있는 규칙은 웹과 앱이 다른 결과를
  내는 버그). `supabase/functions/_shared/core.mjs` 는 생성물이라 손으로 고치지 말 것 —
  core 를 고치고 `npm run bundle-edge -w @gongmoa/core` 로 재생성해 같은 커밋에 넣는다
  (`bundle-edge:check` 가 PR 게이트). `_shared/` 에 규칙 사본(`srs.ts`·`review-pick.ts`·
  `profanity.ts`·`status.ts` 같은 것)을 다시 만들지 말 것 — 2026-09-15 소유자 승인으로 전부
  삭제됐고 Edge 는 `core.mjs` 만 import 한다. Edge 응답은 필드 추가만(삭제·의미 변경은 새 함수명).
  절차는 `docs/agents/edge-core-bundle.md`·`docs/agents/mobile-parity.md`.
