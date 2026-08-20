export type CbtViewMode = "full" | "single";

// CBT를 열었을 때 처음 보여줄 모드. 사이트 기본값은 "문제별 풀기"이고, 계정에
// "전체보기"가 명시적으로 잠겨 있을 때만 전체보기로 시작한다. 문항별 크롭 이미지가
// 아직 없는 문제지는 문제별 탭 자체가 막혀 있으니 전체보기로 시작한다.
//
// 서버(문항 이미지 preload를 넣을지 판단)와 클라이언트(실제 초기 상태)가 같은 답을
// 내야 해서 한 곳에 둔다 — 갈라지면 안 쓸 이미지를 미리 받거나, 정작 필요한 첫
// 문항을 안 받는다.
export function resolveInitialCbtViewMode(
  defaultViewMode: CbtViewMode | null,
  hasQuestionImages: boolean,
): CbtViewMode {
  if (!hasQuestionImages) return "full";
  return defaultViewMode === "full" ? "full" : "single";
}
