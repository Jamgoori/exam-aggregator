// 모바일 전체보기(PDF)에서 OMR을 바텀시트로 덮는 대신 화면을 좌우로 쪼개 쓸 때,
// 오른쪽 OMR이 차지하는 폭의 비율. 사용자가 경계선을 끌어 조절하고, 그 값을
// 기기에 저장해 다음 시험에서도 같은 폭으로 열리게 한다.
export const OMR_SPLIT_STORAGE_KEY = "cbt:omr-split-ratio";

// 너무 좁으면 5지선다 버튼이 눌리지 않고, 너무 넓으면 시험지가 안 보인다.
export const MIN_OMR_SPLIT = 0.3;
export const MAX_OMR_SPLIT = 0.7;
export const DEFAULT_OMR_SPLIT = 0.42;

export function clampOmrSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return DEFAULT_OMR_SPLIT;
  return Math.min(MAX_OMR_SPLIT, Math.max(MIN_OMR_SPLIT, ratio));
}

// 저장값은 사용자가 지운/고친 localStorage에서 오므로 언제든 쓰레기일 수 있다.
export function readStoredOmrSplit(): number {
  if (typeof window === "undefined") return DEFAULT_OMR_SPLIT;
  try {
    const raw = window.localStorage.getItem(OMR_SPLIT_STORAGE_KEY);
    if (!raw) return DEFAULT_OMR_SPLIT;
    return clampOmrSplit(Number.parseFloat(raw));
  } catch {
    return DEFAULT_OMR_SPLIT;
  }
}

export function storeOmrSplit(ratio: number) {
  try {
    window.localStorage.setItem(OMR_SPLIT_STORAGE_KEY, String(clampOmrSplit(ratio)));
  } catch {
    // 사파리 프라이빗 모드 등 저장이 막힌 환경에서도 끌어 쓰는 것 자체는 되어야 한다.
  }
}
