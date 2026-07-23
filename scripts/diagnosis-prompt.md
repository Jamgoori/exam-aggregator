# AI 약점 진단 생성 프롬프트

`next-diagnosis.mjs`가 내려준 입력 JSON을 읽고, 아래 규칙에 따라 사용자별 약점 진단
리포트를 생성한다. 결과는 `save-diagnosis.mjs`가 저장할 JSON 한 건으로 만든다.

## 입력 (next-diagnosis.mjs stdout)

```
{
  "diagnosis_id": "uuid",
  "user_id": "uuid",
  "diagnosis_date": "YYYY-MM-DD",
  "totals": { "attempts": 12, "wrongQuestions": 47, "conceptsWithKeyword": 21 },
  "subjects": [
    { "name": "행정법", "slug": "administrative-law", "attempts": 5,
      "avgScorePct": 70, "recentScores": [62, 70, 75] }
  ],
  "concepts": [
    { "concept": "처분성", "subject": "행정법", "subjectSlug": "administrative-law",
      "wrongCount": 8, "resolvedCount": 2, "frequency": 3 }
  ]
}
```

- `subjects.recentScores`는 오래된→최신 순의 회차별 정오율(%). 추세는 이걸로 판단.
- `concepts`는 틀린 문항 수(`wrongCount`) 내림차순, 최대 30개. 해설이 생성된 문항만
  개념이 잡히므로, 개념이 비어도 과목 통계로는 진단할 수 있다.
- `concepts.frequency`는 출제 빈도 점수(1~3, 값이 없으면 `null`). 전체 기출에서 그 개념이
  얼마나 자주 나오는지를 3분위로 눌러 넣은 것. **자주 나오는데(빈도↑) 아직 약한** 개념이
  가성비가 높으니 미션·Top 3 우선순위에 반영한다. 지어내지 말고 입력값을 그대로 쓴다.

## 작성 규칙

1. **데이터에 근거만.** 입력에 없는 과목·개념·점수를 지어내지 말 것. 숫자는 입력값을
   그대로 인용한다(반올림 금지, 이미 정수).
2. **취약 개념 TOP 3.** `concepts`에서 시급한 순으로 최대 3개 고른다. 우선순위는
   "**자주 나오는데(frequency↑) 많이 틀리고 아직 극복 못 한 것**"(frequency·wrongCount 높고
   resolvedCount 낮음). 즉 가성비(출제 빈도 대비 약점)가 큰 것부터. 개념이 3개 미만이면
   있는 만큼만. `concepts`가 비어 있으면 `weakConcepts`는 빈 배열로 두고, 요약과 과목
   흐름으로만 진단한다.
3. **과목별 흐름.** `subjects`의 `recentScores`로 추세를 판정한다:
   - `up`: 최근 점수가 대체로 오름 / `down`: 대체로 내림 / `flat`: 유지·혼조.
   - `note`는 근거가 되는 점수 흐름과 다음 행동을 한두 문장으로. 실제 점수를 인용.
   - `scores`에는 그 과목의 `recentScores`를 **그대로**(오래된→최신) 실어 준다. 화면이 이걸로
     미니 꺾은선(스파크라인)을 그린다. 회차가 1개뿐이면 그대로 1개만, 없으면 생략한다.
4. **요약(summary).** 3~5문장. 전체 정오율 흐름 → 가장 시급한 약점 → 안정권 과목 순으로.
   과장·위로성 표현 없이 담백하게. 수험생이 "그래서 뭘 하면 되는지"를 알 수 있게.
5. **오늘의 미션(mission).** 화면 최상단 히어로에 들어갈 **한 줄** 행동 지시. 가장 가성비
   높은 취약 개념 하나를 골라, "과목 '개념'만 잡으면 …" 형태로 임팩트 있게. `subjectSlug`는
   그 개념의 slug를 그대로(맞춤 풀기 버튼이 이 과목으로 세션을 만든다). 예상 점수 상승은
   근거가 있을 때만 언급하고, 없으면 빼도 된다. weakConcepts가 비면 `mission`은 `null`.
6. **오답 패턴(insights).** 데이터로 확인되는 "자주 낚이는 지점"을 최대 3개까지 문장형으로.
   각 항목은 `{ subject, text, wrongRatePct }`. `wrongRatePct`는 근거(과목/개념 정오율)가
   있을 때만 넣고, 없으면 생략. 확인 안 되는 함정 유형을 상상해서 쓰지 말 것 — 근거 없으면
   빈 배열.
7. **딥링크·뱃지용 필드 보존.** 각 weakConcept에 입력의 `subject`/`subjectSlug`/`wrongCount`/
   `resolvedCount`/`frequency`를 그대로 실어 준다(화면이 뱃지와 "틀린 문항 모아보기"로
   이어준다). 개념별 `accuracyPct`(내 정답률)는 신뢰할 입력이 없으면 넣지 말 것 — 화면이
   극복 진행도로 대체한다.

## 출력 (save-diagnosis.mjs 입력)

정확히 이 형태의 JSON 한 건만 만든다. 코드블록·주석 없이 순수 JSON.

```json
{
  "diagnosis_id": "<입력의 diagnosis_id 그대로>",
  "model_version": "claude-opus-4-8",
  "report": {
    "summary": "전체 정답률은 상승 중이지만(68% → 75%) 오답이 행정법 판례형에 몰려 있어요. 특히 처분성 개념은 8번 틀리고 2번만 극복해 가장 시급합니다. 한국사는 안정권이에요.",
    "mission": {
      "headline": "행정법 '처분성'만 잡으면 판례형 오답이 확 줄어요. 지금 5문제로 시작!",
      "subjectSlug": "administrative-law",
      "concept": "처분성"
    },
    "weakConcepts": [
      { "concept": "처분성", "subject": "행정법", "subjectSlug": "administrative-law",
        "wrongCount": 8, "resolvedCount": 2, "frequency": 3 }
    ],
    "insights": [
      { "subject": "행정법", "text": "'처분성 인정 여부'를 묻는 판례형 선지에서 자주 놓치고 있어요.", "wrongRatePct": 75 }
    ],
    "subjectTrends": [
      { "subject": "행정법", "trend": "up", "note": "최근 3회 62 → 70 → 75점. 판례 문항만 집중하면 80점대 진입 가능.", "scores": [62, 70, 75] }
    ]
  }
}
```

저장: `node --env-file=.env.local scripts/save-diagnosis.mjs <이 JSON 파일>`
