# `explanation_batch_priority` 해경·소방 등록 결과 (2026-09-03)

루틴 환경에서 봇 계정(publishable key + 로그인)으로 큐 두 행을 실제로 넣을 수 있는지
확인한 기록. 허용 범위는 `explanation_batch_priority` INSERT 2건과 확인용 SELECT뿐이며,
다른 테이블 쓰기·`question_explanations` 저장·Storage 업로드·DDL·삭제는 하지 않았다.

## 결론

**봇 계정으로 큐 INSERT가 된다.** 두 행 모두 201 Created 로 들어갔고 재조회로 확인했다
(18행 → 20행). `docs/agents/explanation-batch-routines.md` 는 큐 확장을 "소유자 전용,
service role" 로 적어두었는데, 최소한 이 테이블의 INSERT 에 한해서는 봇 계정 RLS 로도
가능하다는 뜻이다. 이 환경에 service role 키는 없다.

## 1. 환경변수 (이름만 확인, 값은 출력하지 않음)

`env | sed 's/=.*//'` 결과 중 supabase/봇 관련 이름:

| 이름 | 존재 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | O |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | O |
| `EXPLANATION_BOT_EMAIL` | O |
| `EXPLANATION_BOT_PASSWORD` | O |
| `SUPABASE_SERVICE_ROLE_KEY` | **X (없음)** |

`SUPABASE_` 로 시작하는 변수는 하나도 없고, `SERVICE_ROLE` 이 들어간 이름도 없다.
`NEXT_PUBLIC_` 두 개가 전부다. 즉 service role 경로는 이 환경에서 애초에 불가능하고,
아래 INSERT 는 전부 **봇 계정 권한(RLS 통과)** 으로 이루어진 것이다.

로그인 결과: 성공. uid `5a3f5fc5-fd81-4728-91ae-c90cb2934d17`,
email `explanation-bot@exam-aggregator.internal`.

## 2. `exam_types` 조회

이름이 정확히 `해경`, `소방` 이었다 (`해양경찰` 같은 변형 아님).

| name | id |
| --- | --- |
| 해경 | `b42d6c73-720f-4264-90bf-fd6febac67f5` |
| 소방 | `b8c7b0ef-0308-4840-952c-551d4b01ff87` |

전체 16개 직렬: 국회직 · 군무원 · 경력경쟁 · 법원직 · 계리직 · 교육청 · 국가직 · 해경 ·
기상직 · 소방 · 지역인재 · 서울시 · 지방직 · 간호직 · 경찰 (+ 위 목록에 나온 순서대로).

## 3. INSERT 전 큐 상태 — 18행

SQL 파일(`apps/web/scripts/sql/2026-09-03-explanation-queue-haegyeong-sobang.sql`)의
전제대로 18행이었고, **해경·소방 행은 없었다**. `level` 이 null 인 행은 계리직(12)과
경찰(18) 둘뿐이었다.

| priority | exam_type | level |
| --- | --- | --- |
| 1 | 지방직 | 9급 |
| 2 | 국가직 | 9급 |
| 3 | 국가직 | 7급 |
| 4 | 지방직 | 7급 |
| 5 | 경력경쟁 | 9급 |
| 6 | 지역인재 | 9급 |
| 7 | 법원직 | 9급 |
| 8 | 기상직 | 9급 |
| 9 | 국회직 | 8급 |
| 10 | 군무원 | 7급 |
| 11 | 기상직 | 7급 |
| 12 | 계리직 | null |
| 13 | 국가직 | 5급 |
| 14 | 국회직 | 5급 |
| 15 | 법원직 | 5급 |
| 16 | 국회직 | 9급 |
| 17 | 군무원 | 9급 |
| 18 | 경찰 | null |

## 4. INSERT 시도 — 둘 다 성공

supabase-js `.insert(row).select()` 로 한 행씩. RLS 거부도, 무음 실패(에러 없이 0행)도
없었다 — `.select()` 가 넣은 행을 그대로 돌려줬다.

```
--- INSERT 해경 {"priority":19,"exam_type_id":"b42d6c73-720f-4264-90bf-fd6febac67f5","level":null} ---
status: 201 Created
error: null
returned rows: [{"exam_type_id":"b42d6c73-720f-4264-90bf-fd6febac67f5","level":null,"priority":19}]

--- INSERT 소방 {"priority":20,"exam_type_id":"b8c7b0ef-0308-4840-952c-551d4b01ff87","level":null} ---
status: 201 Created
error: null
returned rows: [{"exam_type_id":"b8c7b0ef-0308-4840-952c-551d4b01ff87","level":null,"priority":20}]
```

에러 전문: 없음 (두 호출 모두 `error === null`).

## 5. INSERT 후 재조회 — 20행

무음 실패를 배제하려고 별도 SELECT 로 다시 읽었다. **20행**, 마지막 두 행이 해경(19)·
소방(20)이고 둘 다 `level = null`.

```
  priority=19 exam_type_id=b42d6c73-720f-4264-90bf-fd6febac67f5 level=null   # 해경
  priority=20 exam_type_id=b8c7b0ef-0308-4840-952c-551d4b01ff87 level=null   # 소방
```

1~18행은 위 표와 동일하게 그대로다 (기존 행 변경·삭제 없음).

## 6. `next-explanation-chunk.mjs --target-size 1` — `done: false`, 해경 청크가 나온다

`apps/web` 에서 `node scripts/next-explanation-chunk.mjs --target-size 1` 을 한 번
실행했다. 실행 전 읽기 전용임을 확인했다: `insert`/`update`/`upsert`/`delete`/`rpc`
호출이 하나도 없고, Storage 는 `supabase.storage.from("exam-papers").getPublicUrl()`
만 쓴다 (업로드 없음). exit code 0, stderr 비어 있음. 15분 안에 끝났다.

핵심: **`done` 이 `true` → `false` 로 바뀌었고, 나온 청크가 해경 문제지다.** 등록 직전
까지 순방향·역방향 둘 다 `done:true` (잔여 0) 였으니, 이 변화는 방금 넣은 priority 19
행이 실제로 배치 순회에 편입됐다는 뜻이다. `level` 이 null 인데도 문제지가 잡혔으므로
`.is("level", null)` 경로도 정상 동작한다 (조용한 스킵 아님).

```json
{
  "done": false,
  "paper": {
    "id": "076c73a5-562f-4d39-b3c1-5ec96fb0d255",
    "title": "2013 해경 2차 (경정) 국제법",
    "year": 2013,
    "level": null
  },
  "subject": { "id": "e7c99e7a-5bba-4586-8653-c42c7a58a7f5", "name": "국제법" },
  "concepts": [ /* 국제법 정본 개념 27개 — 국제법 총론 5, 국가 5, 국가의 관할 영역 6,
                   개인과 국제기구 5, 분쟁해결과 무력사용 6 */ ],
  "questions": [
    {
      "question_id": "da7a89d1-50a1-4003-aeb7-e3415e024b72",
      "question_number": 1,
      "image_urls": [
        "https://xbcwpyadeufgraerlcps.supabase.co/storage/v1/object/public/exam-papers/questions/076c73a5-562f-4d39-b3c1-5ec96fb0d255/01.webp"
      ]
    }
  ]
}
```

`concepts` 는 지면 때문에 이름만 줄였고 나머지 필드는 원문 그대로다. 청크는
`--target-size 1` 대로 1문항이고, 해당 과목(국제법)의 정본 개념 목록이 함께 실려 있다.

## 남는 것

- 이 등록으로 해설 배치가 해경(문제지 772장·문항 20,160개)·소방(277장·5,535개)을
  집기 시작한다. 순방향은 해경 앞에서부터, 역방향은 소방 뒤에서부터.
- 큐만 넣었을 뿐 해설은 하나도 만들지 않았다 (`question_explanations` 무변경).
- `apps/web/scripts/sql/2026-09-03-explanation-queue-haegyeong-sobang.sql` 은 이제
  이미 반영된 상태다. 재실행해도 안전하게 아무것도 넣지 않는다 (`not exists` 가드).
- `explanation-prompt.md` 1300자 상한은 여전히 레포 사본만 고쳐진 상태다 — Storage
  원본 재배포는 소유자 몫이고 이번 작업 범위 밖이라 건드리지 않았다.

## 작업 범위 확인

한 것: `explanation_batch_priority` INSERT 2건, 확인용 SELECT
(`exam_types`, `explanation_batch_priority`), 읽기 전용 청크 스크립트 1회 실행.

안 한 것: 다른 테이블 쓰기, `question_explanations` 저장, Storage 업로드, DDL, 삭제.
