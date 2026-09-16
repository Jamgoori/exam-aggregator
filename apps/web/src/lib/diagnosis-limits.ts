// 맞춤 극복법의 개념 수 상한. 개념 하나당 표본 문항이 프롬프트에 붙고 두 문장이
// 생성되므로 **요금이 개념 수에 정비례한다** — 이 두 값이 곧 유저당 진단 1회 요금이다.
//
// 서버(lib/diagnosis-generate.ts)와 선택창(클라이언트 컴포넌트)이 같은 숫자를 말해야 해서
// 여기 따로 뒀다. server-only 를 붙이지 않는 이유가 그것이다 — 화면이 "이번에 개념 몇 개를
// 다루는지"를 안내하려면 클라이언트에서도 읽어야 한다.
//
// 배치 경로(scripts/next-diagnosis.mjs)는 plain node 라 이 파일을 import 하지 못해 같은
// 값을 복제해 두었다. **바꿀 때 반드시 함께 고칠 것** — 두 경로가 어긋나면 같은 계정에
// 대해 배치와 앱이 서로 다른 개념 집합을 코칭한다.

// 과목당 상한과 개념 선택 키는 core 가 정본이다(diagnosis-targets.ts·diagnosis-report.ts) —
// 선정 규칙(pickCoachTargets)이 웹 화면·웹 생성기·Edge `diagnosis-aggregate` 세 곳에서
// 같은 개념을 골라야 하므로 상수와 키 규칙이 규칙 옆에 있어야 한다. 여기는 기존 import
// 경로를 지키는 re-export 뿐이다.
//
// COACH_PER_SUBJECT: 전체 상위 N개만 뽑으면 문항을 많이 푼 과목이 자리를 다 가져간다
// (실측 계정에서 상위 5개가 국어·영어뿐이었다). 과목당으로 끊어야 준비하는 모든 과목이
// 최소한 다뤄진다.
//
// COACH_MAX_TOTAL: 15에서 10으로 내렸다. 극복법 한 덩이가 두 문장에서 "원인 + 문항별 근거 +
// 실행 계획 + 체크리스트"로 커지면서 개념 하나당 입력·출력이 함께 늘었고, 15개를 꽉 채우면
// 한 번에 1,000원대가 나갔다. 한 주에 10개도 실제로 다 잡기는 벅찬 양이다.
//
// conceptSelectionKey: 같은 표기(keyword_title)라도 과목이 다르면 다른 개념이므로, 정본
// 개념 id 가 있으면 그것을 쓰고 없을 때만 표기로 떨어진다 — 집계의 개념 키와 **같은 규칙**
// 이어야 화면에서 고른 개념과 프롬프트가 맞물린다.
export { COACH_PER_SUBJECT, COACH_MAX_TOTAL, conceptSelectionKey } from "@gongmoa/core";
