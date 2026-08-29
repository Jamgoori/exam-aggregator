// 급수(9급·7급·5급) 정렬 규칙 — 웹·모바일 공유(순수). 색은 플랫폼별이라 각 앱에 둔다.
import { compareKo } from "./collate";

// 급수 탭/정렬에 쓰는 우선순위 (낮을수록 앞쪽에 노출)
export const LEVEL_ORDER = ["9급", "7급", "5급"];

export function compareLevels(a: string, b: string): number {
  const ai = LEVEL_ORDER.indexOf(a);
  const bi = LEVEL_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return compareKo(a, b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
