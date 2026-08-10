// 급수 정렬(compareLevels)은 @gongmoa/core 로 단일화(모바일과 공유). 색은 Tailwind
// 클래스 문자열이라 앱에서 못 쓰므로 여기 남긴다.
export { compareLevels, LEVEL_ORDER } from "@gongmoa/core";

const LEVEL_COLORS: Record<string, string> = {
  "9급": "bg-blue-600 text-white",
  "8급": "bg-teal-600 text-white",
  "7급": "bg-orange-500 text-white",
  "5급": "bg-purple-600 text-white",
};

export function levelColor(level: string) {
  return LEVEL_COLORS[level] ?? "bg-zinc-500 text-white";
}
