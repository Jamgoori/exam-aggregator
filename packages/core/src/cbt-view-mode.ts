// CBT 시작 모드 — 웹 lib/cbt-view-mode.ts 를 옮긴 것(웹 파일은 re-export). 웹 서버(문항 이미지
// preload 판단)·웹 클라이언트(초기 상태)·앱(초기 상태)이 같은 답을 내야 해서 한 곳에 둔다.
export type CbtViewMode = "full" | "single";

// CBT를 열었을 때 처음 보여줄 모드. 사이트 기본값은 "문제별 풀기"이고, 계정에
// "전체보기"가 명시적으로 잠겨 있을 때만 전체보기로 시작한다. 문항별 크롭 이미지가
// 아직 없는 문제지는 문제별 탭 자체가 막혀 있으니 전체보기로 시작한다.
export function resolveInitialCbtViewMode(
  defaultViewMode: CbtViewMode | null,
  hasQuestionImages: boolean,
): CbtViewMode {
  if (!hasQuestionImages) return "full";
  return defaultViewMode === "full" ? "full" : "single";
}

// user_metadata.default_cbt_view_mode 원값 → 모드. 명시적으로 저장된 값이 없으면(한 번도
// 자물쇠를 잠근 적 없음) null — "전체보기로 시작"과 "전체보기를 기본값으로 잠가둔 것"은
// 자물쇠 아이콘 표시상 서로 다른 상태라 뭉개면 안 된다(웹 cbt/page.tsx:100-107).
export function parseCbtViewMode(raw: unknown): CbtViewMode | null {
  return raw === "single" || raw === "full" ? raw : null;
}
