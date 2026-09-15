# 모바일 파리티 — 웹에 기능을 넣을 때 앱이 같이 받게 하는 절차

설계서: `apps/mobile/docs/redesign-architecture.md` (§6 데이터·동기화, §8.3 게이트 파리티,
§9 파리티 매트릭스, §10 AGENTS.md 항목). 앱 쪽 금지선 원본: `apps/mobile/AGENTS.md`.
번들·계약 테스트 절차: `docs/agents/edge-core-bundle.md`, `docs/agents/contract-tests.md`.

웹과 앱은 같은 Supabase 를 쓰고, 규칙은 `packages/core/src/rules` 한 곳에 있다. 웹 서버 액션에만
규칙을 쓰면 **앱은 그 기능을 못 받거나, 받아도 다른 결과를 낸다.** 아래 다섯 단계를 한 PR 에서
끝낸다. 앱이 그 기능을 쓰지 않더라도(관리자 전용 등) 1·2 는 지킨다.

## 절차 (기능 하나 = 다섯 단계)

| 단계 | 어디에 | 무엇을 |
|---|---|---|
| 1. 규칙 | `packages/core/src/rules/<name>.ts` (+`.test.ts`) | 순수 규칙 + 주입된 클라이언트 호출. `now`/`fuzz` 등 비결정 요소는 `deps` 로. `src/server.ts` 에서 export |
| 2. 웹 어댑터 | `apps/web/src/app/**/actions.ts` 또는 route handler | 인증 → 입력 파싱 → 규칙 호출 → `revalidatePath`. 규칙을 여기 쓰지 않는다 |
| 3. Edge / RPC 어댑터 | `supabase/functions/<name>/index.ts` 또는 `supabase/schema.sql` 의 RPC | service_role 이 필요하면 EF(`_shared/http.ts` + `_shared/clients.ts` + `_shared/core.mjs`), 본인 행만 다루는 단순 읽기/집계면 SD RPC(§6.7 공통 규칙: `auth.uid()` null 검사, `search_path`, 모든 where 에 `user_id = auth.uid()`). `npm run bundle-edge -w @gongmoa/core` 로 `core.mjs` 갱신 |
| 4. 계약 테스트 | `packages/core/src/rules/__fixtures__/`, `test:contract` | 같은 입력 → 웹 어댑터 vs Edge → 결과 행 동일. 케이스 표에 행 추가 |
| 5. 매트릭스 | 설계서 §9 | 기능 행 추가(웹 경로·앱 경로·접근 방식·게이트·계약 테스트 번호). 앱이 안 받는 기능이면 "앱 범위 밖" 으로 명시 |

판단 기준 몇 가지:

- **EF 인가 RPC 인가**: 정답·해설·멤버십을 읽거나 쓰면 EF. SRS 상수가 필요하면 EF(SQL 에
  상수를 두면 세 번째 복사본이 생긴다 — `review-guessed` 를 RPC 로 만들지 않은 이유). 본인 행
  집계·토글이면 RPC.
- **응답은 추가만**: 기존 EF 응답에 필드를 더하는 것은 괜찮다. 빼거나 바꾸면 새 함수명.
- **게이트 파리티**(§8.3): 웹에서 `isPremium` 뒤에 있는 기능은 EF 안에서도 같은 판정을 한다.
  앱은 게이트를 실행하지 않고 결과(`lockReason`)를 그린다.
- **캐시 무효화**: 웹의 `revalidatePath` 에 대응하는 앱 쿼리 키(`['me', userId, …]`)를 §6.3 무효화
  지도에 적는다. 새 테이블을 읽는 기능이면 키 접두를 정한다.
- **RLS 를 새로 열 때**: 앱이 직접 쓰게 하려고 정책을 여는 것은 규칙 우회 경로를 만드는 일이다.
  아래 금지선 표의 테이블은 열지 않는다.

## 앱이 절대 하지 않는 것 (설계서 §6.1 금지선 + §10 AGENTS.md 목록)

웹 코드를 고칠 때도 이 목록을 전제로 한다 — 예를 들어 앱이 `memberships` 를 못 쓰므로 체험 시작
로직을 서버 액션에만 두면 앱은 체험을 못 켠다.

- **직접 쓰지 않는 테이블**: `memberships`, `user_question_status`, `review_sessions`,
  `paper_answers`, `question_explanations`. RLS 상 불가능하고 정책을 열지도 않는다.
- **버킷 쓰기 정책을 열지 않는다**: `avatars`, `board-images`. 업로드는 EF(리사이즈·형식 강제).
- **체험 시작은 `start_trial_if_eligible` RPC 하나**, 그것도 EF(`membership-get`) 안에서만.
  이 RPC 는 service_role 전용이라 앱 세션으로는 호출 자체가 거부된다. `memberships` 직접
  UPDATE 금지(웹·앱 양쪽 — AGENTS.md "무료 체험 시작" 금지선).
- **정답·해설·멤버십을 디스크에 남기지 않는다**: `correctChoice`, 채점된 `questionResults`,
  `own_wrong_answers` 결과, 해설 본문, 제출 전후 복습 세션 항목, 멤버십 행·`is_admin`, 진단
  리포트 본문 — 메모리 쿼리캐시만(§6.5). 서버가 이런 값을 새 응답에 실을 때는 앱 쪽
  `meta.persist:false` 대상이라는 것을 계약 타입 주석에 적는다.
- **광고 없는 화면**: CBT(`/papers/[id]/cbt`), 복습·mix 솔버, PDF 뷰어, OMR 시트, 결과 모달 근처.
  앱 오픈·전면·보상형 광고 사용 안 함(§8.4).
- **`@gongmoa/core/server` import 금지**(ESLint). service_role 규칙은 앱 번들에 들어가지 않는다.
- **`GEO_BLOCK_BYPASS_TOKEN` 을 번들·OTA·링크에 싣지 않는다.** 앱이 웹 도메인을 부르는 경로는
  `/terms`·`/privacy`·`/api/app/config`·`/.well-known/*`·`/app-ads.txt` 다섯 개뿐이고 전부
  geo-block 면제 목록에 있다. 새 웹 URL 을 앱에서 부르게 하려면 면제 목록(`lib/geo-block.ts`,
  `docs/agents/geo-block.md`)부터.
- **웹 `/download/*` 를 호출하지 않는다.** PDF 는 Storage 공개 URL 을 직접 연다.
- **`increment_download_count` 는 사용자가 저장·공유 탭을 누른 순간에만.** 뷰어 진입·프리로드에서
  부르지 않는다.
- **앱은 SRS 를 계산·기록하지 않는다.** `srs_*` 는 채점 EF 만 쓴다. 승격(`promotePendingItems`)은
  세션 생성 시에만.
- **로컬에 권위 있는 상태를 두지 않는다.** 멤버십·응시·SRS·출석은 서버 행이 정본, 앱 캐시는 표시용.

## 금지선

- 웹 서버 액션에만 규칙을 쓰고 끝내지 말 것. 1(core)·3(Edge/RPC) 없이 머지된 기능은 앱에서
  "없거나 다른" 기능이 된다.
- 앱 편의를 위해 위 목록의 테이블·버킷에 클라이언트 쓰기 정책을 열지 말 것.
- Edge 응답 필드를 빼거나 의미를 바꾸지 말 것(새 함수명).
- 파리티 매트릭스(§9)에 행을 안 적고 기능을 넣지 말 것. 매트릭스가 곧 "앱이 무엇을 받아야
  하는가" 의 정본이고, 없는 행은 이식 단계에서 빠진다.
