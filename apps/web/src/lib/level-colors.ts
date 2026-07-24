const LEVEL_COLORS: Record<string, string> = {
  "9급": "bg-blue-600 text-white",
  "7급": "bg-orange-500 text-white",
  "5급": "bg-purple-600 text-white",
};

export function levelColor(level: string) {
  return LEVEL_COLORS[level] ?? "bg-zinc-500 text-white";
}

// 급수 탭/정렬에 쓰는 우선순위 (낮을수록 앞쪽에 노출)
const LEVEL_ORDER = ["9급", "7급", "5급"];

export function compareLevels(a: string, b: string) {
  const ai = LEVEL_ORDER.indexOf(a);
  const bi = LEVEL_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1;
  if (bi === -1) return -1;
  return ai - bi;
}
