// 맞춤 극복법의 대상 개념 선정 — 순수 규칙. 웹 `lib/diagnosis-generate.ts#pickCoachTargets`
// 에서 옮겼다.
//
// 옮긴 이유: 이 함수가 두 곳에서 같은 답을 내야 한다. 웹 진단 페이지는 선택창의 "추천"
// 체크를 이걸로 미리 켜 두고(`mypage/diagnosis/page.tsx`), 생성기는 사용자가 아무것도
// 고르지 않았을 때 이걸로 대상을 정한다. 앱 화면(Edge `diagnosis-aggregate`)도 같은 추천을
// 그려야 하는데, 그쪽에 한 벌 더 쓰면 같은 계정이 웹과 앱에서 다른 개념을 추천받는다.
//
// 개념 수가 곧 요금이라(개념 하나 = 프롬프트 한 덩이) 상한 두 개가 이 파일의 전부다.

import { COACH_MAX_TOTAL } from "./data/home";
import { conceptSelectionKey, type DiagnosisConceptSelection } from "./diagnosis-report";

// 과목당 상한. 전체 상위 N개만 뽑으면 문항을 많이 푼 과목이 자리를 다 가져간다
// (실측 계정에서 상위 5개가 국어·영어뿐이었다). 과목당으로 끊어야 준비하는 모든 과목이
// 최소한 다뤄진다. (전체 상한 COACH_MAX_TOTAL 은 data/home.ts — 앱 소개 화면과 공유한다.)
export const COACH_PER_SUBJECT = 7;

// 선정에 필요한 최소한의 모양. 집계(rules/diagnosis-aggregate 의 ConceptStat)도, 그것을
// 앱용으로 줄인 보드 개념(BoardConcept)도 이 모양을 만족하므로 양쪽에서 같은 함수를 쓴다.
export type CoachTargetConcept = {
  concept: string;
  conceptId: string | null;
  subjectSlug: string | null;
  wrongCount: number;
  accuracyPct: number | null;
};

// 코칭 대상 개념을 고른다. 과목 안에서는 많이 틀린 순, 동률이면 정답률이 낮은 쪽을
// 먼저 — 같은 3문항이라도 "5문항 중 3개"가 "20문항 중 3개"보다 급하다.
//
// 과목당 COACH_PER_SUBJECT 개까지 뽑되 전체가 COACH_MAX_TOTAL 을 넘지 않게, 순위별로
// 돌아가며(1위끼리 → 2위끼리 → …) 채운다. 과목 순서대로 7개씩 채우면 상한에 걸릴 때
// 뒤쪽 과목이 통째로 빠지는데, 그러면 "내 과목은 아예 안 봐주네"가 된다.
//
// excludedSubjectSlugs 는 사용자가 진단에서 뺀 과목이다(review_preferences 의
// diagnosis_paused_subject_ids). 빼는 만큼 남은 과목이 상한을 더 깊게 쓴다.
//
// selected 가 있으면(화면에서 개념을 직접 체크한 경우) 아래 자동 선정은 건너뛰고 고른
// 개념만 남긴다 — 사용자가 정한 것을 우리가 "더 시급한 것"으로 바꿔치면 체크박스가
// 장식이 된다. 상한은 요금 상한이라 그때도 그대로 적용된다.
export function pickCoachTargets<T extends CoachTargetConcept>(
  agg: { concepts: T[] },
  excludedSubjectSlugs: Set<string>,
  selected: DiagnosisConceptSelection[] | null = null,
): T[] {
  if (selected && selected.length > 0) return pickSelectedConcepts(agg, selected);

  const bySubject = new Map<string, T[]>();
  for (const c of agg.concepts) {
    const slug = c.subjectSlug ?? "";
    if (slug && excludedSubjectSlugs.has(slug)) continue;
    const list = bySubject.get(slug) ?? [];
    if (list.length >= COACH_PER_SUBJECT) continue;
    list.push(c);
    bySubject.set(slug, list);
  }
  // 과목 순서는 그 과목에서 틀린 문항이 많은 쪽부터 — 상한에 걸려 잘리는 자리는
  // 오답이 적은 과목의 하위 개념이어야 한다.
  const groups = [...bySubject.values()].sort(
    (a, b) =>
      b.reduce((n, c) => n + c.wrongCount, 0) - a.reduce((n, c) => n + c.wrongCount, 0),
  );
  for (const g of groups) {
    g.sort((a, b) => b.wrongCount - a.wrongCount || (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101));
  }

  const picked: T[] = [];
  for (let rank = 0; rank < COACH_PER_SUBJECT && picked.length < COACH_MAX_TOTAL; rank++) {
    for (const g of groups) {
      if (picked.length >= COACH_MAX_TOTAL) break;
      if (g[rank]) picked.push(g[rank]);
    }
  }
  return picked;
}

// 사용자가 고른 개념만 추린다. 순서는 집계 순서(많이 틀린 순)를 그대로 따르고,
// 이 기간에 오답이 없어 집계에 없는 개념은 조용히 빠진다 — 표본 문항이 없으면 모델이
// 일반론밖에 못 내므로 요금만 나간다.
function pickSelectedConcepts<T extends CoachTargetConcept>(
  agg: { concepts: T[] },
  selected: DiagnosisConceptSelection[],
): T[] {
  const wanted = new Set(selected.map(conceptSelectionKey));
  const picked: T[] = [];
  for (const c of agg.concepts) {
    if (!wanted.has(conceptSelectionKey(c))) continue;
    picked.push(c);
    if (picked.length >= COACH_MAX_TOTAL) break;
  }
  return picked;
}
