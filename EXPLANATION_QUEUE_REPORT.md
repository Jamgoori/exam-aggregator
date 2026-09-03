# 해설 배치 큐 실측 점검 (2026-09-03)

읽기 전용 점검. DB 쓰기 작업은 하지 않았다 (`select` / `count=exact,head=true` 질의만).
봇 계정(`EXPLANATION_BOT_EMAIL`) + publishable key 로 로그인해서 조회했다.

## 결론 요약

**처리 가능한 문항은 전부 처리됐다. 잔여 0.**

- 순방향·역방향 `next-explanation-chunk.mjs` 둘 다 `done: true` (양쪽 끝에서 수렴 완료).
- 큐 등록·비제외 문항 **80,065건 전부**에 해설이 있다. 그룹별 잔여도 전부 0.
- 다만 **큐에 아예 등록되지 않은 그룹이 2개(해경·소방, 25,695문항)** 있고, 이 문항들은
  `explanation_batch_priority`에 행이 없어서 **영원히 처리되지 않는다**. 잔여 0은
  "큐에 등록된 범위 안에서" 0이라는 뜻이다.

## 1. `next-explanation-chunk.mjs` 실행 결과

`apps/web` 에서 실행 (읽기 전용 스크립트임을 Read 로 먼저 확인).

```
$ node scripts/next-explanation-chunk.mjs --target-size 1
{"done":true,"reason":"모든 우선순위 그룹 처리 완료"}

$ node scripts/next-explanation-chunk.mjs --target-size 1 --reverse
{"done":true,"reason":"모든 우선순위 그룹 처리 완료"}
```

둘 다 exit code 0. `done: false` 가 아니므로 보고할 paper 정보는 없다.

이 스크립트는 우선순위 그룹 → 문제지 → 문항 순으로 훑으면서 `question_explanations`에
없는 문항이 하나라도 나오면 그 청크를 반환한다. 조회 오류가 나면 `process.exit(1)`로
죽는데 둘 다 정상 종료했으므로, **큐 등록·비제외 범위 전체를 오류 없이 완주하고
미처리 문항을 하나도 못 찾았다**는 뜻이다. (한 방향당 약 20분 소요 — 4,839장 문제지를
전부 훑는다.)

## 2. count 질의 실측

`select("id", { count: "exact", head: true })` 로 조회.

### 전체 개수

| 항목 | 개수 |
|---|---|
| `questions` 전체 | **107,810** |
| `question_explanations` 전체 | **80,345** |
| `exam_papers` 전체 | 4,839 |
| `exam_papers` 의 (exam_type_id, level) 조합 | 20 |
| `explanation_batch_priority` 행 | 18 |

### 제외 과목 (`explanation_excluded_subjects`)

8개 과목이 등록돼 있다 — 러시아어, 불어, 수학, 중국어, 스페인어, 독어, 과학, 일어.

| 항목 | 개수 |
|---|---|
| 제외 과목 문제지의 문항 수 합계 | **2,610** |
| 그중 큐 등록 그룹 안에 있는 문항 | 2,050 |
| 그중 큐 미등록 그룹(해경·소방) 안에 있는 문항 | 560 |

### 큐 미등록 그룹 — 처리 대상에서 통째로 빠져 있음

`exam_papers` 에는 있지만 `explanation_batch_priority` 에 (exam_type_id, level) 행이
없는 그룹. 문서(`docs/agents/explanation-batch-routines.md`)의 경고대로 **이 테이블에
없는 그룹은 영원히 처리되지 않는다.**

| 그룹 | 문제지 | 문항 수 |
|---|---:|---:|
| 해경 / (급수없음) | 772 | **20,160** |
| 소방 / (급수없음) | 277 | **5,535** |
| **합계** | 1,049 | **25,695** |

두 그룹 모두 현재 해설이 **0건**이다 (count 질의로 확인).

반대 방향 확인: `explanation_batch_priority` 18행 중 대응하는 문제지가 하나도 없는
행은 **없다** (전에 비어 있던 국회직 5급도 문제지 58장이 생겼다 — 다만 아직 크롭된
문항이 0개라 처리 대상 문항은 0).

### 큐 등록 그룹별 잔여 (제외 과목 문항 제외)

| 그룹 | 문제지 | 문항(전체) | 문항(비제외) | 해설 | 잔여 |
|---|---:|---:|---:|---:|---:|
| 국가직 / 9급 | 665 | 13,300 | 12,900 | 12,900 | **0** |
| 국가직 / 7급 | 764 | 17,000 | 15,710 | 15,710 | **0** |
| 국가직 / 5급 | 41 | 1,520 | 1,520 | 1,520 | **0** |
| 지방직 / 9급 | 491 | 9,820 | 9,460 | 9,460 | **0** |
| 지방직 / 7급 | 191 | 3,820 | 3,820 | 3,820 | **0** |
| 경찰 / (급수없음) | 380 | 10,520 | 10,520 | 10,520 | **0** |
| 경력경쟁 / 9급 | 128 | 2,560 | 2,560 | 2,560 | **0** |
| 군무원 / 7급 | 164 | 3,250 | 3,250 | 3,250 | **0** |
| 군무원 / 9급 | 126 | 2,525 | 2,525 | 2,525 | **0** |
| 법원직 / 9급 | 220 | 5,350 | 5,350 | 5,350 | **0** |
| 법원직 / 5급 | 39 | 1,560 | 1,560 | 1,560 | **0** |
| 국회직 / 9급 | 251 | 5,020 | 5,020 | 5,020 | **0** |
| 국회직 / 8급 | 122 | 2,820 | 2,820 | 2,820 | **0** |
| 국회직 / 5급 | 58 | 0 | 0 | 0 | **0** (크롭 문항 없음) |
| 기상직 / 9급 | 64 | 1,280 | 1,280 | 1,280 | **0** |
| 기상직 / 7급 | 30 | 650 | 650 | 650 † | **0** |
| 계리직 / (급수없음) | 23 | 460 | 460 | 460 | **0** |
| 지역인재 / 9급 | 33 | 660 | 660 | 660 | **0** |
| **합계** | 3,790 | 82,115 | **80,065** | **80,065** | **0** |

† 기상직 7급의 해설 count 질의만 25회 재시도 후에도 계속 HTTP 500(빈 메시지)으로
실패했다 (아래 참고). 값 650은 아래 정합성 검산과 두 방향 `done: true` 로 확정한
것이지 직접 count 질의로 받은 숫자가 아니다.

### 정합성 검산 (숫자가 전부 맞아떨어진다)

```
문항:  82,115 (큐 등록 그룹) + 25,695 (큐 미등록) = 107,810 = questions 전체 ✓

해설:  79,415 (기상직 7급 제외한 큐 등록 그룹 실측 합)
     +    650 (기상직 7급 — 이 검산으로 역산)
     +    280 (제외 과목 문항에 이미 달려 있는 해설)
     +      0 (해경·소방)
     = 80,345 = question_explanations 전체 ✓
```

`question_explanations` 전체(80,345)와 큐 등록·비제외 문항 수(80,065)의 차이 280건은
**제외 과목 문항에 달린 해설**이다 (해당 과목이 제외 등록되기 전에 생성된 것으로 보인다).
count 질의로 직접 확인했다 — 해경·소방 쪽 해설은 0건이므로 미등록 그룹에서 새어나온
해설은 없다.

## 3. 조회 실패 / 주의사항

- **`question_explanations` 관련 count 질의가 간헐적으로 HTTP 500(빈 메시지)을 낸다.**
  같은 질의를 그대로 다시 던지면 통한다 — 5회 반복 시도에서 4회 실패 후 1회 성공
  (`count=80345`, 매 시도 7~10초). 타임아웃 성격으로 보인다. 그래서 이 점검의 count
  질의는 전부 재시도로 감쌌다. **RLS 문제가 아니다** (봇 계정은 `admin read
  question_explanations` 정책으로 읽을 수 있고, 실제로 재시도하면 값이 나온다).
- 기상직 7급 그룹의 해설 count 만 재시도 25회로도 끝내 실패했다. 위 검산으로 650
  (잔여 0)이 확정되지만, 직접 조회한 숫자가 아니라는 점은 명시해 둔다.
- RLS 로 아예 못 읽은 테이블은 **없다**. `questions`, `question_explanations`,
  `exam_papers`, `exam_types`, `subjects`, `explanation_batch_priority`,
  `explanation_excluded_subjects` 전부 조회 성공.

## 4. 후속 제안 (이번 점검에서는 아무것도 변경하지 않음)

큐 등록 범위 안에서는 할 일이 없다. 남은 건 큐 자체의 구멍이다:

1. **해경(20,160문항)·소방(5,535문항)을 `explanation_batch_priority` 에 등록할지 결정.**
   등록하지 않는 한 이 25,695문항은 계속 해설 없이 남는다. 등록은 소유자가
   `node --env-file=.env.local scripts/explanation-queue-status.mjs` (service role)
   로 확인 후 행을 추가하는 절차다. 등록 시 문서의 "최후순위 그룹은 잔여량 기준
   정중앙에 둔다" 규칙을 함께 볼 것 — 지금은 앞뒤 잔여가 모두 0이라 균형 기준이
   달라진다.
2. **국회직 5급은 문제지 58장이 있으나 크롭된 문항이 0개다.** 크롭이 끝나면 큐에
   이미 등록돼 있으므로 자동 편입된다.
3. 현재 상태에서는 순방향·역방향 루틴이 매 세션 `done: true` 만 받고 끝난다
   (한 방향당 약 20분씩 전체 스캔). 큐를 늘리지 않을 거라면 루틴 발동 주기를
   줄이거나 멈추는 것도 검토할 만하다.

## 부록: 실행한 명령

```bash
# 1) 청크 스크립트 (apps/web 에서)
node scripts/next-explanation-chunk.mjs --target-size 1
node scripts/next-explanation-chunk.mjs --target-size 1 --reverse

# 2) count 질의 — 스크래치패드의 임시 스크립트로 실행 (레포에 커밋하지 않음).
#    전부 읽기 전용이며, 형태는 아래와 같다:
#
#    supabase.from("questions").select("id", { count: "exact", head: true })
#    supabase.from("question_explanations").select("id", { count: "exact", head: true })
#
#    제외 과목 문항 수:
#    .from("questions")
#      .select("id, exam_papers!inner(subject_id)", { count: "exact", head: true })
#      .in("exam_papers.subject_id", excludedIds)
#
#    그룹별 문항 수 (제외 과목 빼고):
#    .from("questions")
#      .select("id, exam_papers!inner(exam_type_id, level, subject_id)", { count: "exact", head: true })
#      .eq("exam_papers.exam_type_id", t)
#      .eq("exam_papers.level", l)          // level 이 null 이면 .is("exam_papers.level", null)
#      .not("exam_papers.subject_id", "in", `(${excludedIds})`)
#
#    그룹별 해설 수 (제외 과목 빼고):
#    .from("question_explanations")
#      .select("id, questions!inner(exam_papers!inner(exam_type_id, level, subject_id))",
#              { count: "exact", head: true })
#      .eq("questions.exam_papers.exam_type_id", t)
#      .eq("questions.exam_papers.level", l)  // null 이면 .is(...)
#      .not("questions.exam_papers.subject_id", "in", `(${excludedIds})`)
```

`level` 이 null 인 그룹(경찰·계리직)은 `.eq("level", null)` 이 조용히 0건만 매칭하므로
반드시 `.is()` 를 썼다 (문서에 기록된 2026-08-09 실측 사고와 같은 이유).
