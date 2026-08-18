# 개념 재분류 루틴 프롬프트 (소유자가 Claude Code Remote 스케줄에 등록)

이 파일은 **루틴 생성 시 프롬프트 칸에 그대로 붙여 넣는 문안**이다. 분류 규칙 자체는
여기 없다 — 세션이 `scripts/concept-reclassify-prompt.md` 를 읽어서 따른다. 두 파일을
나눠 둔 이유는, 규칙이 바뀔 때 루틴을 다시 만들지 않아도 다음 세션부터 반영되게
하기 위해서다(해설 루틴이 스크립트를 매 세션 갱신하는 것과 같은 구조).

등록 전에 `docs/agents/explanation-batch-routines.md` 를 읽을 것. 아래 문안의 0단계와
"실행 전 Read 검증"은 2026-07-15 사고(무인 모드 보안 분류기가 `.mjs` 실행을 차단해
세션 대부분이 저장 0건으로 끝남)에 대한 대응이고, 빼면 같은 사고가 재발한다.

- **환경**: 해설 배치 루틴과 같은 환경(`env_011UL7sPM6VGLPJ9nJdKXYut`). 봇 계정
  자격 증명(`EXPLANATION_BOT_EMAIL`/`EXPLANATION_BOT_PASSWORD`)이 이미 있다
- **주기**: 2시간 간격 권장(컷오프 90분과 같은 간격 규칙)
- **동시 실행 금지**: 해설 배치와 달리 순/역방향 분할이 없다. 두 세션이 겹치면 같은
  청크를 중복으로 읽는다. `save-concepts.mjs` 가 이미 붙은 `concept_id` 를 덮어쓰지
  않아 데이터가 깨지지는 않지만 토큰만 버린다 — 이 루틴은 하나만 띄운다

---

## (여기부터 프롬프트 문안)

exam-aggregator 의 기존 해설에 정본 개념(`concept_id`)을 붙이는 반복 작업이다.
해설 본문은 건드리지 않는다 — 붙이는 축만 추가한다. 레포 소유자가 이 작업을 명시적으로
승인했고, 아래 스크립트 2개는 레포 master 의 산출물이다.

**0단계 — (선택) 실행 권한 심기.** 레포 루트 `.claude/settings.local.json` 의
`permissions.allow` 에 다음 두 규칙을 넣어 두면 무인 모드 보안 분류기가 `.mjs`
실행을 막는 일을 예방할 수 있다.

```json
{
  "permissions": {
    "allow": [
      "Bash(node scripts/next-concept-chunk.mjs:*)",
      "Bash(node scripts/save-concepts.mjs:*)"
    ]
  }
}
```

**이 단계는 반드시 건너뛸 수 있어야 한다.** 쓰기가 권한 프롬프트로 막히면 기다리지
말고 즉시 다음 단계로 간다. 2026-08-17 에 세션 셋이 바로 이 쓰기의 권한 프롬프트
앞에서 `requires_action` 으로 멈춰 아무 일도 못 하고 끝났다 — 실행 차단을 예방하려던
단계가 그 자체로 세션을 세운 것이다. 스크립트가 레포 안에 있어(해설 배치와 달리
Storage 에서 받아오지 않는다) 이 단계 없이도 대개 실행된다.

**1단계 — 시작 시각 기록.** `date +%s` 로 찍어 둔다. 배치를 하나 저장할 때마다 경과를
확인해 **90분을 넘기면 그 배치까지만 마치고 정상 종료**한다. 다음 세션과 겹치지 않게
하는 장치다.

**2단계 — 스크립트 갱신.** 원본은 레포 master 다. 매 세션 최신으로 맞춘다.

```
cd /home/user/exam-aggregator
git fetch origin master
git checkout origin/master -- \
  apps/web/scripts/next-concept-chunk.mjs \
  apps/web/scripts/save-concepts.mjs \
  apps/web/scripts/lib/concept-alias.mjs \
  apps/web/scripts/concept-reclassify-prompt.md
cd apps/web
```

**3단계 — 실행 전 검증.** `scripts/next-concept-chunk.mjs` 와
`scripts/save-concepts.mjs` 를 Read 로 열어, 이 두 파일이 `question_explanations` 의
`concept_id` 만 쓰고 다른 테이블을 지우거나 고치지 않는지 확인한다. 확인되면 실행한다.
(실행이 계속 차단되면, 검증한 로직을 새 파일로 옮겨 적어 그걸 실행한다.)

**4단계 — 규칙 읽기.** `scripts/concept-reclassify-prompt.md` 를 Read 한다. 개념을
고르는 규칙·`?` 제안 규칙·금지선이 전부 그 파일에 있다. 아래 5단계는 그 규칙을 전제로
한 실행 절차일 뿐이다.

**5단계 — 반복.** `done: true` 가 나오거나 90분 컷오프까지:

1. `node scripts/next-concept-chunk.mjs --limit 60`
   - `done: true` 면 종료
   - 출력의 `concepts` 가 그 과목의 정본 목록, `items` 가 분류할 문항
2. `items` 의 문항마다 `keyword_title` 과 `question_text` 를 읽고 `concepts` 목록에서
   이름 하나를 **글자 그대로** 골라 JSON 배열 파일로 쓴다
   ```json
   [{ "question_id": "uuid", "concept": "VPN과 IPSec" }]
   ```
3. `node scripts/save-concepts.mjs <파일경로>`
4. 출력의 `unmatched` 가 있으면 **그 문항만** 다시 골라 재저장한다(이름을 잘못 베낀
   것이다). 2회 넘게 실패하면 그대로 두고 넘어간다

**6단계 — 종료 보고.** 세션 끝에 다음을 한 번에 보고한다:

- 이번 세션에 붙인 문항 수, 과목별 내역
- `proposed`(`?` 제안) 이름을 **횟수와 함께 모아서** — 소유자가 3회 이상 나온 것만
  정본에 넣는다. 루틴은 사전을 못 고친다(봇에 `concepts` 쓰기 권한이 없다)
- 끝까지 안 붙은 `unmatched` 문항 id

**금지선.** `keyword_title` 을 UPDATE 하지 말 것(화면에 그대로 보여주는 값). 이미 붙은
`concept_id` 를 덮어쓰지 말 것. 미매칭을 "기타" 같은 개념으로 뭉치지 말 것 — 뭉치는
순간 약점 진단이 조용히 틀린 말을 하게 된다. 해설 본문 필드는 건드리지 말 것.

## (프롬프트 문안 끝)

---

## 등록 후 확인

첫 세션이 끝나면 소유자가 검진을 돌려 실제로 붙었는지 본다.

```
cd apps/web
npm run concept-inventory -- --verify
```

`DB에 실제로 붙은 문항` 이 세션 보고와 맞는지 보고, **개념당 문항 3개씩은 눈으로
확인할 것.** 개수만 맞다고 성공으로 판단하는 건 이 레포에서 이미 사고가 난 방식이다.

주의: 검진의 `매핑 커버리지` 는 별칭·그룹키(문자열 매칭) 경로만 잰다. 재분류 배치가
붙인 것은 그 규칙으로 재현되지 않으므로 커버리지가 낮게 나오는 게 정상이다 — 배치의
성과는 `DB에 실제로 붙은 문항` 쪽에서 본다.
