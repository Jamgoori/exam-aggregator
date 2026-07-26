// 어느 색을 쓸지 고르는 해시는 @gongmoa/core 로 단일화(모바일과 공유) — 같은 과목이
// 웹과 앱에서 팔레트의 같은 자리 색을 갖는다. 팔레트 값 자체는 Tailwind 클래스라 여기.
import { subjectColorIndex } from "@gongmoa/core";

const PALETTE = [
  "bg-blue-100 text-blue-700",
  "bg-rose-100 text-rose-700",
  "bg-amber-100 text-amber-700",
  "bg-emerald-100 text-emerald-700",
  "bg-violet-100 text-violet-700",
  "bg-teal-100 text-teal-700",
  "bg-orange-100 text-orange-700",
  "bg-sky-100 text-sky-700",
];

export function subjectColor(slug: string) {
  // core 의 SUBJECT_PALETTE_SIZE 와 길이가 같지만, 한쪽만 늘어나도 깨지지 않게 나머지.
  return PALETTE[subjectColorIndex(slug) % PALETTE.length];
}
