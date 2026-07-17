// 국가직/지방직/지역인재처럼 카드에서 한눈에 구분돼야 하는 직렬 배지 색상.
// 급수(level)·과목(subject) 배지와 헷갈리지 않도록 테두리만 있는 스타일을 쓴다.
const EXAM_TYPE_COLORS: Record<string, string> = {
  국가직: "border border-indigo-300 text-indigo-700",
  지방직: "border border-emerald-300 text-emerald-700",
  지역인재: "border border-pink-300 text-pink-700",
  서울시: "border border-cyan-300 text-cyan-700",
  법원직: "border border-amber-300 text-amber-700",
  경찰: "border border-slate-400 text-slate-700",
  해경: "border border-sky-300 text-sky-700",
  소방: "border border-red-300 text-red-700",
  계리직: "border border-lime-300 text-lime-700",
  기상직: "border border-teal-300 text-teal-700",
  간호직: "border border-fuchsia-300 text-fuchsia-700",
  국회직: "border border-violet-300 text-violet-700",
};

export function examTypeColor(name: string) {
  return EXAM_TYPE_COLORS[name] ?? "border border-zinc-300 text-zinc-700";
}

// 직렬 선택 탭(다중 선택)에서 "선택됨" 상태를 나타낼 때 쓰는, 배경까지 채운 버전.
const EXAM_TYPE_TAB_COLORS: Record<string, string> = {
  국가직: "border border-indigo-300 bg-indigo-50 text-indigo-700",
  지방직: "border border-emerald-300 bg-emerald-50 text-emerald-700",
  지역인재: "border border-pink-300 bg-pink-50 text-pink-700",
  서울시: "border border-cyan-300 bg-cyan-50 text-cyan-700",
  법원직: "border border-amber-300 bg-amber-50 text-amber-700",
  경찰: "border border-slate-400 bg-slate-100 text-slate-700",
  해경: "border border-sky-300 bg-sky-50 text-sky-700",
  소방: "border border-red-300 bg-red-50 text-red-700",
  계리직: "border border-lime-300 bg-lime-50 text-lime-700",
  기상직: "border border-teal-300 bg-teal-50 text-teal-700",
  간호직: "border border-fuchsia-300 bg-fuchsia-50 text-fuchsia-700",
  국회직: "border border-violet-300 bg-violet-50 text-violet-700",
};

export function examTypeTabColor(name: string) {
  return EXAM_TYPE_TAB_COLORS[name] ?? "border border-zinc-400 bg-zinc-100 text-zinc-700";
}

// 시험 카드 배지: 급수(level) 배지처럼 배경을 꽉 채운 스타일. 흰 글자 대비가
// 낮은 색상(cyan/amber/sky/lime/teal)은 600대로 한 단계 진하게 써서 가독성을 맞춘다.
const EXAM_TYPE_FILLED_COLORS: Record<string, string> = {
  국가직: "bg-indigo-500 text-white",
  지방직: "bg-emerald-500 text-white",
  지역인재: "bg-pink-500 text-white",
  서울시: "bg-cyan-600 text-white",
  법원직: "bg-amber-600 text-white",
  경찰: "bg-slate-600 text-white",
  해경: "bg-sky-600 text-white",
  소방: "bg-red-500 text-white",
  계리직: "bg-lime-600 text-white",
  기상직: "bg-teal-600 text-white",
  간호직: "bg-fuchsia-500 text-white",
  국회직: "bg-violet-500 text-white",
};

export function examTypeFilledColor(name: string) {
  return EXAM_TYPE_FILLED_COLORS[name] ?? "bg-zinc-500 text-white";
}
