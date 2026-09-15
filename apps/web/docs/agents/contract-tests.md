# 계약 테스트 (웹 어댑터 ↔ Edge Function 결과 동일성)

관련 파일: `.github/workflows/contract-tests.yml` · `packages/core/src/rules/__fixtures__/*.sql` ·
`packages/core` 의 `test:contract` 스크립트(도입 중) · `supabase/config.toml` · `supabase/seed.sql`
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

## 결정성 — `now` 와 `fuzz` 를 주입한다

`recordQuestionResults` 는 `nextSrs(…, { fuzz })` 로 간격을 흔들고(`fuzzInterval`), `now` 로
`srs_due_at` 을 계산한다. 두 어댑터가 각자 `Math.random()`·`new Date()` 를 쓰면 reps ≥ 3 케이스의
`srs_interval_days`·`srs_due_at` 스냅샷이 매번 다르다.

- core `rules/question-status.ts`(및 시각을 읽는 모든 규칙)는 `deps: { now, fuzz }` 를 받는다.
  기본값은 `new Date()` / `Math.random`.
- 계약 테스트는 양쪽에 **같은 고정값**을 넣는다: `fuzz: () => 0.5`, `now: new Date("2026-01-15T00:00:00+09:00")`
  같은 상수. 웹 어댑터는 함수 인자로 바로 넣는다. Edge 쪽은 HTTP 경계를 넘어야 하므로 테스트
  전용 입력 경로가 필요한데(제안: 테스트 전용 헤더를 `functions serve` 의 `--env-file` 로 켠
  환경변수가 있을 때만 읽음), 정확한 방식은 `test:contract` 를 넣는 PR 에서 정하고 이 문단을
  갱신한다. 어떤 방식이든 **프로덕션 배포에서는 그 입력이 무시돼야 한다** — 클라이언트가 시각을
  지정할 수 있으면 SRS 가 조작된다.
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

1. 픽스처: `packages/core/src/rules/__fixtures__/<case>.sql`. 사용자·문제지·정답·상태 행을
   `on conflict do nothing` 으로 넣는다. 고정 UUID 를 쓴다(스냅샷에 id 가 들어간다).
2. 입력: 케이스 파일에 `input`(요청 본문)과 `deps`(`now`, `fuzz`)를 상수로 둔다.
3. 실행: 헬퍼 `runBoth(case)` 가 픽스처 적재 → 웹 어댑터 호출 → 행 스냅샷 → DB 초기화 → 픽스처
   재적재 → Edge 호출 → 행 스냅샷을 돌려준다. 두 스냅샷을 `deepStrictEqual`.
4. 스냅샷에서 비교하지 않을 열은 명시적으로 제외한다(`id` 가 서버 생성인 테이블의 `id`,
   `created_at` 이 `now()` 기본값인 열). 제외 목록은 케이스마다 적지 말고 헬퍼의 상수 한 곳에.
5. 동시성 케이스는 `Promise.all` 로 두 요청을 같은 어댑터에 넣고 행 개수를 단언한다 — 양쪽 어댑터
   각각에 대해.
6. 위 표에 행을 추가하고, 설계서 §9 파리티 매트릭스에 "계약 테스트 #n" 을 적는다.

## 금지선

- 스냅샷이 다르다고 **어댑터 쪽을 고쳐 맞추지 말 것.** 규칙이 core 밖으로 샌 것이므로 규칙을
  core 로 옮기고 두 어댑터가 그것을 부르게 한다.
- 테스트를 통과시키려고 `now`/`fuzz` 주입을 프로덕션 Edge 가 요청에서 항상 읽게 만들지 말 것.
  클라이언트가 시각을 지정할 수 있으면 SRS 가 조작된다.
- 프로덕션 Supabase 를 가리키고 돌리지 말 것. 픽스처가 실제 사용자 행을 덮는다. 워크플로는
  로컬 `supabase start` 값만 쓴다.
- 동시 제출 케이스(#4·#5)를 "불안정하다"고 빼지 말 것. 그 케이스가 §6.6 의 원자 회수·선점이
  실제로 동작하는지를 보는 유일한 검사다. 불안정하면 규칙이 read-then-write 로 되돌아간 것이다.
