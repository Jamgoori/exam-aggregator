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

// 과목당 상한. 전체 상위 N개만 뽑으면 문항을 많이 푼 과목이 자리를 다 가져간다
// (실측 계정에서 상위 5개가 국어·영어뿐이었다). 과목당으로 끊어야 준비하는 모든 과목이
// 최소한 다뤄진다.
export const COACH_PER_SUBJECT = 7;

// 전체 상한. 과목이 많은 사용자의 요금 폭주를 막는 장치 — 5과목이면 과목당 7개가
// 35개가 된다. 요금이 개념 수에 정비례하므로 이 값을 올리는 건 그대로 요금 인상이다.
export const COACH_MAX_TOTAL = 15;

// 지금 고른 과목 수로 이번 생성이 실제로 다룰 개념 수. 선택창이 "과목을 빼면 남은 과목을
// 더 깊게 본다"를 숫자로 보여주는 데 쓴다.
export function plannedConceptCount(subjectCount: number): number {
  if (subjectCount <= 0) return 0;
  return Math.min(COACH_MAX_TOTAL, subjectCount * COACH_PER_SUBJECT);
}

// 진단 화면의 개념 카드 상한(TOP N). 막대그래프는 과목별로 상위 몇 개만 그리지만,
// 카드는 "무엇부터 잡을지" 목록이라 한 화면에 20위까지 세운다. 21위부터는 이 주기의
// 우선순위라고 부르기 어렵고, 카드가 길어질수록 1위의 무게가 옅어진다.
//
// AI 극복법 상한(COACH_MAX_TOTAL)과 다른 값인 게 정상이다 — 카드는 집계(무료·무AI)라
// 개수를 늘려도 요금이 늘지 않고, 극복법만 요금이 개념 수에 정비례한다. 그래서
// 20위까지 세워두고 그중 상위 개념에만 극복법이 붙는다.
export const TOP_CONCEPT_CARDS = 20;

// 카드를 접지 않고 바로 보여주는 개수. 나머지(FOLD+1 ~ TOP_CONCEPT_CARDS)는 접어 둔다 —
// 스무 장을 한꺼번에 펼치면 스크롤이 길어져 정작 1위부터 손대게 만드는 힘이 사라진다.
export const CONCEPT_CARDS_BEFORE_FOLD = 8;
