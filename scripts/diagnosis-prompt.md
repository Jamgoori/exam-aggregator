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
      "wrongCount": 8, "resolvedCount": 2 }
  ]
}
```

- `subjects.recentScores`는 오래된→최신 순의 회차별 정오율(%). 추세는 이걸로 판단.
- `concepts`는 틀린 문항 수(`wrongCount`) 내림차순, 최대 30개. 해설이 생성된 문항만
  개념이 잡히므로, 개념이 비어도 과목 통계로는 진단할 수 있다.

## 작성 규칙

1. **데이터에 근거만.** 입력에 없는 과목·개념·점수를 지어내지 말 것. 숫자는 입력값을
   그대로 인용한다(반올림 금지, 이미 정수).
2. **취약 개념 TOP 3.** `concepts`에서 시급한 순으로 최대 3개 고른다. 우선순위는
   "많이 틀리고 아직 극복 못 한 것"(wrongCount 높고 resolvedCount 낮음). 개념이 3개 미만이면
   있는 만큼만. `concepts`가 비어 있으면 `weakConcepts`는 빈 배열로 두고, 요약과 과목
   흐름으로만 진단한다.
3. **과목별 흐름.** `subjects`의 `recentScores`로 추세를 판정한다:
   - `up`: 최근 점수가 대체로 오름 / `down`: 대체로 내림 / `flat`: 유지·혼조.
   - `note`는 근거가 되는 점수 흐름과 다음 행동을 한두 문장으로. 실제 점수를 인용.
4. **요약(summary).** 3~5문장. 전체 정오율 흐름 → 가장 시급한 약점 → 안정권 과목 순으로.
   과장·위로성 표현 없이 담백하게. 수험생이 "그래서 뭘 하면 되는지"를 알 수 있게.
5. **딥링크용 필드 보존.** 각 weakConcept에 입력의 `subject`/`subjectSlug`/`wrongCount`/
   `resolvedCount`를 그대로 실어 준다(화면이 "틀린 문항 모아보기"로 이어준다).

## 출력 (save-diagnosis.mjs 입력)

정확히 이 형태의 JSON 한 건만 만든다. 코드블록·주석 없이 순수 JSON.

```json
{
  "diagnosis_id": "<입력의 diagnosis_id 그대로>",
  "model_version": "claude-opus-4-8",
  "report": {
    "summary": "전체 정답률은 상승 중이지만(68% → 75%) 오답이 행정법 판례형에 몰려 있어요. 특히 처분성 개념은 8번 틀리고 2번만 극복해 가장 시급합니다. 한국사는 안정권이에요.",
    "weakConcepts": [
      { "concept": "처분성", "subject": "행정법", "subjectSlug": "administrative-law",
        "wrongCount": 8, "resolvedCount": 2 }
    ],
    "subjectTrends": [
      { "subject": "행정법", "trend": "up", "note": "최근 3회 62 → 70 → 75점. 판례 문항만 집중하면 80점대 진입 가능." }
    ]
  }
}
```

저장: `node --env-file=.env.local scripts/save-diagnosis.mjs <이 JSON 파일>`
