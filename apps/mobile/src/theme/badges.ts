import { subjectColorIndex } from "@gongmoa/core";

// 급수·직렬·과목 배지 색. 웹(exam-card, level-colors, exam-type-colors, subject-colors)이
// 쓰는 Tailwind 값을 그대로 hex 로 옮긴 것이라 같은 문제지가 웹과 앱에서 같은 색으로 보인다.
// 어느 색을 쓸지 고르는 규칙(과목 해시)은 @gongmoa/core 에 있어 자리까지 일치한다.
//
// 웹도 이 배지들은 다크모드에서 색을 바꾸지 않는다(채운 배경 + 흰 글자라 대비가 충분).
// 앱도 같게 둔다.
export type Badge = { bg: string; fg: string };

const WHITE = "#ffffff";

// 웹 levelColor: 9급 blue-600 / 7급 orange-500 / 5급 purple-600 / 그 외 zinc-500
const LEVEL: Record<string, string> = {
  "9급": "#2563eb",
  "7급": "#f97316",
  "5급": "#9333ea",
};

export function levelBadge(level: string): Badge {
  return { bg: LEVEL[level] ?? "#71717a", fg: WHITE };
}

// 웹 examTypeFilledColor: 흰 글자 대비가 WCAG AA(4.5:1) 이상이 되는 명도로 고른 값들.
const EXAM_TYPE: Record<string, string> = {
  국가직: "#4f46e5", // indigo-600
  지방직: "#047857", // emerald-700
  지역인재: "#db2777", // pink-600
  서울시: "#0e7490", // cyan-700
  법원직: "#b45309", // amber-700
  경찰: "#475569", // slate-600
  해경: "#0369a1", // sky-700
  소방: "#dc2626", // red-600
  계리직: "#4d7c0f", // lime-700
  기상직: "#0f766e", // teal-700
  간호직: "#c026d3", // fuchsia-600
  국회직: "#7c3aed", // violet-600
};

export function examTypeBadge(name: string): Badge {
  return { bg: EXAM_TYPE[name] ?? "#71717a", fg: WHITE };
}

// 웹 subject-colors 팔레트(bg-*-100 / text-*-700)와 같은 순서.
const SUBJECT: Badge[] = [
  { bg: "#dbeafe", fg: "#1d4ed8" }, // blue
  { bg: "#ffe4e6", fg: "#be123c" }, // rose
  { bg: "#fef3c7", fg: "#b45309" }, // amber
  { bg: "#d1fae5", fg: "#047857" }, // emerald
  { bg: "#ede9fe", fg: "#6d28d9" }, // violet
  { bg: "#ccfbf1", fg: "#0f766e" }, // teal
  { bg: "#ffedd5", fg: "#c2410c" }, // orange
  { bg: "#e0f2fe", fg: "#0369a1" }, // sky
];

export function subjectBadge(slug: string): Badge {
  return SUBJECT[subjectColorIndex(slug) % SUBJECT.length];
}
