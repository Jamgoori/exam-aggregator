# 계약 테스트 (웹 어댑터 ↔ Edge Function 결과 동일성)

관련 파일: `.github/workflows/contract-tests.yml` · `packages/core/scripts/contract-tests.mjs`
(`npm run test:contract -w @gongmoa/core`) · `supabase/functions/_shared/clients.ts#testOverrides` ·
`supabase/config.toml` · `supabase/seed.sql`
설계 배경: `apps/mobile/docs/redesign-architecture.md` §6.6·§11 "계약 테스트".

## 무엇을 증명하나

같은 입력을 (a) **웹 어댑터**(node 에서 `@gongmoa/core/server` 규칙을 service_role 클라이언트로
호출)와 (b) **Edge Function**(`supabase functions serve` 에 HTTP 로 호출)에 넣었을 때, 로컬 DB 에
남는 결과 행이 **똑같은가**. 비교 대상 테이블:

`cbt_attempts`, `cbt_attempt_answers`, `user_question_status`(`srs_*` 포함), `srs_reviews`,
`review_session_items`, `attendance_days`, `memberships`.

행을 스냅샷으로 떠서 비교한다. 응답 JSON 이 아니라 **DB 행**을 보는 이유: 어댑터가 응답을 다르게
포장해도 규칙이 같으면 행은 같고, 응답이 같아 보여도 규칙이 갈리면 행이 다르다. 웹 서버 액션이
어댑터가 됐다는 말은 "웹 동작이 바뀌지 않았다"는 뜻이어야 하고, 이 테스트가 그 증거다.

## 케이스 목록 (§11 에서 그대로)

| # | 케이스 | 확인하는 것 |
|---|---|---|
| 1 | CBT 제출 — voided 문항 포함 | `voided_questions` 처리가 양쪽 동일 |
| 2 | CBT 제출 — 90초 미만 | 양쪽 모두 거절(`MIN_ATTEMPT_SECONDS`), 행 0 |
| 3 | CBT 제출 — 재제출 | 시작 행 회수 후 두 번째 제출 거절 |
| 4 | **CBT 동시 제출 2건** | `cbt_attempts` 1행, `user_question_status.wrong_count` +1, `attendance_days.question_count` 1회분 (§6.6 원자 회수) |
| 5 | 복습 동시 제출 2건 | 채점 1회(`submitted_at` 선점) |
| 6 | 복습 제출 scope `mix` / `review` | `user_question_status.source` 가 각각 `mix`/`review` |
| 7 | dedup 형제 문제지 상태 대상 | 문항 수가 **다른** 형제 포함 — `resolveStatusTargets` 결과 동일 |
| 8 | 해설 접근 순서 | 시간당 40 → 프리미엄 → 일일 3 판정 순서 |
| 9 | 해설 `context:"wrong-note"` | 쿼터·`explanation_access_log` 미차감, 형제 `paper_id` 매핑 |
| 10 | 체험 1회 | `start_trial_if_eligible` 두 번 → `memberships` 변화 1회, `trial_consumptions` 원장 |
| 11 | 출석 임계·마일스톤 | 10문항·2초 임계, `attendance_grants` 멱등 |
| 12 | 닉네임 트리거 | `auth.users` 메타 변경 → `profiles` 동기화·거절 |
| 13 | `review-create` 응답 | `paperId`/`correctChoice` **부재**(정답 유출 없음) |
| 14 | `own_wrong_answers` | (a) 형제 문제지 행만 있는 사용자 → 반환 (b) 행 없음 → 미반환 (c) `selected_choice` null → 반환 |
| 15 | `review-create` 멱등 | 30분 재사용 **없음**; 같은 `requestId` 두 번 → 세션 1개(유니크 인덱스) |

케이스 이름은 이 표의 번호·제목을 그대로 쓴다(스냅샷 파일명도).

지금 `contract-tests.mjs` 에 들어 있는 것: #1 · #2 · #4 · #5+#6(`review` source 만) · #8(비로그인
미리보기만) · #10 · #13+#15. 나머지(#3 재제출, #6 `mix`, #7 문항 수 다른 형제, #8 한도 순서, #9,
#11 마일스톤, #12 닉네임 트리거, #14)는 아직 없다 — 추가할 때 이 줄을 갱신한다.

## 결정성 — `now` 와 `fuzz` 를 주입한다

`recordQuestionResults` 는 `nextSrs(…, { fuzz })` 로 간격을 흔들고(`fuzzInterval`), `now` 로
`srs_due_at` 을 계산한다. 두 어댑터가 각자 `Math.random()`·`new Date()` 를 쓰면 reps ≥ 3 케이스의
`srs_interval_days`·`srs_due_at` 스냅샷이 매번 다르다.

- core `rules/question-status.ts`(및 시각을 읽는 모든 규칙)는 `deps: { now, fuzz }` 를 받는다.
  기본값은 `new Date()` / `Math.random`.
- 계약 테스트는 양쪽에 **같은 고정값**을 넣는다: `fuzz: () => 0.5`, `now` 는 스크립트의 `CLOCK`
  상수(+케이스별 오프셋). 웹 어댑터 경로는 규칙 함수의 `opts.now` / `opts.questionStatus.fuzz` 로
  바로 넣는다.
- **Edge 쪽 주입 경로**: 요청 헤더 `x-gongmoa-test-clock`(ISO 8601 → `now`)과
  `x-gongmoa-test-fuzz`(0 이상 1 미만 → `fuzz = () => 값`). `supabase/functions/_shared/clients.ts` 의
  `testOverrides(req)` 가 **환경변수 `GONGMOA_TEST_HOOKS=1` 일 때만** 헤더를 읽고, 아니면 빈 객체를
  돌려준다. `cbt-start`·`cbt-submit`·`review-submit` 이 그 값을 규칙 opts 로 넘긴다. 워크플로가
  `functions serve --env-file supabase/.env.local` 에 넣는 파일에만 이 변수가 있다 — **프로덕션
  `supabase secrets` 에는 절대 넣지 말 것.** 클라이언트가 채점 시각을 지정할 수 있으면 최소
  응시시간이 무력화되고 SRS 가 조작된다. 스크립트는 시작 전에 `cbt-start` 의 `startedAt` 이 보낸
  시각과 같은지 확인해(`probeTestHooks`) 훅이 꺼져 있으면 그 이유로 바로 실패한다.
- `CLOCK` 은 `FREE_UNTIL`(전면 무료 기간) **뒤**의 시각이다. 그 기간에는 출석이 닫혀 있어
  (`isAttendanceOpen`) `attendance_days` 가 남지 않아 "출석 1회분" 단언을 못 한다. 단언은
  `isAttendanceOpen(CLOCK)` 을 보고 자동으로 전환되므로 `FREE_UNTIL` 을 밀어도 깨지지 않는다.
- 스냅샷이 비결정적으로 흔들리면 주입이 빠진 자리가 있는 것이다. `Math.random`·`Date.now()`·
  `new Date()` 를 규칙 안에서 직접 부르는 곳을 찾는다.

## 어디서 도나 — GitHub Actions 만

Docker(`supabase start`)가 필요하다. 로컬에서도 돌릴 수는 있지만(`docs/dev-workflow.md` 의
터미널 2 상태에서 `npm run test:contract -w @gongmoa/core`) PR 게이트로서는
`.github/workflows/contract-tests.yml` 만 본다. 트리거: `supabase/**`·`packages/core/**` 를 건드린
PR + 수동 실행.

워크플로 순서: `supabase/setup-cli` → `supabase start` → `supabase db reset`(`config.toml` 의
`[db.seed] sql_paths` 가 `schema.sql` → `seed.sql` 순으로 적재) → `supabase functions serve` 백그라운드
→ `npm run test:contract -w @gongmoa/core`.

`SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 는 `supabase status -o env` 로 얻어
환경변수로 넘긴다. 계약 테스트는 Anthropic 을 부르지 않으므로 `ANTHROPIC_API_KEY` 는 더미다.

## 케이스를 추가하는 법

1. 픽스처: `contract-tests.mjs#ensureFixtures` 가 admin 클라이언트로 고정 UUID
   (`00000000-0000-4000-8000-00000000c0xx` 대역)를 `ignoreDuplicates` upsert 로 넣고 끝에 지운다.
   지금 있는 것: 과목·직렬 1개씩, 문제지 2장(dedup 형제, 정답 동일 `[1,2,3,4,5]`, voided `[5]`),
   문항·이미지 5개씩, 해설 5개. 케이스가 더 필요한 행은 여기에 보탠다.
2. 사용자: 웹 경로용·Edge 경로용 두 계정(`USERS.web`/`USERS.edge`)을 `auth.admin.createUser` 로
   만들고 `signInWithPassword` 로 JWT 를 받는다. 케이스마다 두 사용자에게 같은 입력을 넣는다.
3. 실행: 케이스 함수 하나가 웹 경로(`core.*` 규칙을 admin 으로 직접 호출) → Edge 경로(`edge()` 로
   HTTP 호출) → `snapshot(userId)` 두 번 → `compareSnapshots`. 앞 케이스의 행이 필요 없으면
   `resetUsers()` 로 시작한다.
4. 비교하지 않을 열은 `SNAPSHOT` 상수 한 곳에 적는다(서버 생성 `id`·`user_id`·DB `now()` 기본값
   시각). 주입한 시각으로 계산되는 열(`last_answered_at`·`srs_due_at`·`submitted_at` …)은 그대로
   비교한다. 뽑기 순서가 무작위인 `review_session_items.position` 은 제외하고 (문제지, 문항)으로
   정렬한다.
5. 동시성 케이스는 `Promise.all` 로 두 요청을 같은 어댑터에 넣고 행 개수를 단언한다 — 양쪽 어댑터
   각각에 대해(#4 가 그 예).
6. 위 표와 "지금 들어 있는 것" 줄을 갱신하고, 설계서 §9 파리티 매트릭스에 "계약 테스트 #n" 을 적는다.

## 금지선

- 스냅샷이 다르다고 **어댑터 쪽을 고쳐 맞추지 말 것.** 규칙이 core 밖으로 샌 것이므로 규칙을
  core 로 옮기고 두 어댑터가 그것을 부르게 한다.
- 테스트를 통과시키려고 `now`/`fuzz` 주입을 프로덕션 Edge 가 요청에서 항상 읽게 만들지 말 것.
  클라이언트가 시각을 지정할 수 있으면 SRS 가 조작된다.
- 프로덕션 Supabase 를 가리키고 돌리지 말 것. 픽스처가 실제 사용자 행을 덮는다. 워크플로는
  로컬 `supabase start` 값만 쓴다.
- 동시 제출 케이스(#4·#5)를 "불안정하다"고 빼지 말 것. 그 케이스가 §6.6 의 원자 회수·선점이
  실제로 동작하는지를 보는 유일한 검사다. 불안정하면 규칙이 read-then-write 로 되돌아간 것이다.
