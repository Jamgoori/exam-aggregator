// 시행처 마크(public/exam-types). 문제지 카드 배지 줄 맨 왼쪽에 붙여, 급수·직렬
// 배지를 읽기 전에 색과 모양만으로 어느 시험인지 알아보게 하는 용도다.
//
// 한 파일을 여러 직렬이 함께 쓰는 건 실제로 마크가 같아서다 — 국가직·지방직·
// 기상직·지역인재·경력경쟁·간호직은 모두 정부상징(태극 문양)을 쓴다.
// 서울시·교육청은 자체 상징이 따로 있는데 아직 자료가 없어 마크도 두지 않았다.
// 없으면 null 이고, 카드는 아이콘 자리를 통째로 비운다.
const EXAM_TYPE_ICONS: Record<string, string> = {
  국가직: "/exam-types/government.webp",
  지방직: "/exam-types/government.webp",
  기상직: "/exam-types/government.webp",
  지역인재: "/exam-types/government.webp",
  경력경쟁: "/exam-types/government.webp",
  간호직: "/exam-types/government.webp",
  경찰: "/exam-types/police.webp",
  해경: "/exam-types/coastguard.webp",
  소방: "/exam-types/fire.webp",
  군무원: "/exam-types/military.webp",
  법원직: "/exam-types/court.webp",
  국회직: "/exam-types/assembly.webp",
  계리직: "/exam-types/post.webp",
};

export function examTypeIcon(name: string): string | null {
  return EXAM_TYPE_ICONS[name] ?? null;
}
