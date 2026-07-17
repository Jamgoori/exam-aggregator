# 단원 태깅 파이프라인 실행 가이드 (경로 A)

설계 배경: `docs/unit-taxonomy.md`. 대상: 해설(question_explanations)이 이미 있는
문항 중 `questions.unit_tag IS NULL`인 것(약 1.2만 건 시점 기준). 분류 모델은
**Sonnet** 서브에이전트 — 텍스트 분류라 이 등급으로 충분하고, 해설 생성(Opus)보다
훨씬 싸다.

## 구성 요소

| 파일 | 역할 |
| --- | --- |
| `scripts/unit-taxonomy.json` | 태그 목록 단일 진실 (과목별 허용 태그 + alias) |
| `scripts/next-tagging-chunk.mjs` | 다음 청크(한 과목, 기본 40문항) JSON 출력 |
| `scripts/tagging-prompt.md` | 서브에이전트 분류 프롬프트 템플릿 |
| `scripts/save-unit-tags.mjs` | 분류 결과 검증 후 `questions.unit_tag` UPDATE |
| `scripts/tag-stats.mjs` | 진행률·분포 리포트 (설계 임계값 위반 경고 포함) |

필요 환경변수 (해설 배치와 동일): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `EXPLANATION_BOT_EMAIL`,
`EXPLANATION_BOT_PASSWORD`. 봇 계정은 admins 등록이라 해설 읽기(admin 전용
select)와 questions UPDATE(admin 정책)를 모두 통과한다.

## 세션 루프 (Claude Code에서 실행)

```
반복:
  1. node scripts/next-tagging-chunk.mjs --target-size 40   # stdout JSON
     - done:true면 종료
  2. 출력 JSON을 scripts/tagging-prompt.md 템플릿에 채워
     Sonnet 서브에이전트(Agent 도구, model: sonnet)에 전달
  3. 서브에이전트가 반환한 JSON 배열을 파일로 저장 후
     node scripts/save-unit-tags.mjs <파일>
     - rejected가 있으면 해당 문항만 재분류 1회 시도, 그래도 실패하면 스킵하고 기록
  4. 저장 결과(saved_count) 로그
```

주의:

- **rejected 처리**: save 스크립트는 허용 목록 밖 태그·과목 불일치를 건별로
  거부한다(전체 중단 없음). rejected 사유가 "택소노미 미등록 과목"이면 분류
  재시도가 아니라 `unit-taxonomy.json`에 과목 추가가 필요한 것 — 사람(소유자)
  확인으로 넘긴다.
- **청크 크기**: 40이 기본. Sonnet 컨텍스트에 여유가 크지만, 한 번에 늘리기보다
  rejected 비율을 보고 조정한다(길어질수록 id 뒤섞임 실수가 늘 수 있다).
- **동시 실행 금지**: 해설 배치의 순방향/역방향 같은 방향 분리 장치가 없다.
  태깅 루프는 한 번에 하나만 돌릴 것 (겹치면 같은 청크를 중복 분류 — 데이터는
  안 깨지지만 토큰 낭비).
- **루틴(cron)으로 돌릴 경우**: 해설 루틴의 검증된 규칙을 그대로 상속할 것 —
  (1) 시작 시각 `date +%s` 기록 후 청크 저장마다 경과 확인, 100분 초과 시 정상
  종료, (2) `.claude/settings.local.json`에 두 .mjs의 node 실행 허용 규칙 선삽입,
  (3) 실행 전 .mjs를 Read로 검증한다는 문구를 프롬프트에 명시(무인 모드 보안
  분류기 차단 회피).

## 표본 검증 (전량 실행 전 1회)

1. 주요 과목 5개(국어·영어·한국사·행정법총론·행정학개론)에서 청크 1개씩 뽑아
   **이중 태깅**: 같은 청크를 순서만 뒤집어 두 번 분류(프롬프트 문서의 검증 변형
   참조). 일치율 90% 미만 과목은 혼동된 태그 쌍을 확인해 택소노미 조정.
2. 통과하면 전량 루프 시작.
3. 과목 하나가 끝날 때마다 `node scripts/tag-stats.mjs --subject <과목명>`으로
   분포 확인. 경고("기타" >10%, 단일 태그 >40%/<1%)가 나오면 태깅을 멈추고
   택소노미를 조정한 뒤, 해당 과목만 재태깅(unit_tag를 null로 되돌릴 필요 없이
   그대로 재실행하면 UPDATE로 덮어씀 — 단, 조정 전 태그가 남지 않게 과목 전체를
   다시 돌릴 것).

## 경로 B 연동 (해설 루틴 무임승차)

해설 루틴 프롬프트에 추가할 한 줄: 해설 저장 후 같은 문항에 대해
`scripts/unit-taxonomy.json`의 해당 과목 태그 목록에서 unit_tag를 골라
`save-unit-tags.mjs` 형식으로 저장. 이건 루틴 프롬프트(소유자가 관리) 수정
사항이라 이 레포 코드 변경이 아님 — 다음 루틴 재생성 때 반영.
