// 시행처 마크. 웹 src/lib/exam-type-icons.ts 와 같은 표이고 파일도 같은 것을 쓴다
// (apps/web/scripts/build-exam-type-icons.mjs 가 웹·앱 두 곳에 같이 구워 넣는다).
// 배지 색(theme/badges.ts)과 마찬가지로 같은 문제지가 양쪽에서 같게 보여야 한다.
//
// 한 파일을 여러 직렬이 함께 쓰는 건 실제로 마크가 같아서다 — 국가직·지방직·
// 기상직·지역인재·경력경쟁·간호직은 모두 정부상징(태극 문양)을 쓴다.
// 서울시·교육청은 자체 상징이 따로 있는데 아직 자료가 없어 마크도 두지 않았다.
// 없으면 undefined 이고, 카드는 아이콘 자리를 통째로 비운다.
//
// 타입이 number 인 건 Metro 가 번들 에셋 require 를 모듈 id(숫자)로 바꾸기
// 때문이다 — expo-image 의 source 가 그대로 받는다.
//
// import 가 아니라 require 인 이유: Metro 가 번들에 넣을 에셋은 정적 require 로만
// 찾아내고, *.webp 모듈 선언이 없어 import 는 타입 검사도 통과하지 못한다.
const EXAM_TYPE_ICONS: Record<string, number> = {
  국가직: require("../../assets/exam-types/government.webp"),
  지방직: require("../../assets/exam-types/government.webp"),
  기상직: require("../../assets/exam-types/government.webp"),
  지역인재: require("../../assets/exam-types/government.webp"),
  경력경쟁: require("../../assets/exam-types/government.webp"),
  간호직: require("../../assets/exam-types/government.webp"),
  경찰: require("../../assets/exam-types/police.webp"),
  해경: require("../../assets/exam-types/coastguard.webp"),
  소방: require("../../assets/exam-types/fire.webp"),
  군무원: require("../../assets/exam-types/military.webp"),
  법원직: require("../../assets/exam-types/court.webp"),
  국회직: require("../../assets/exam-types/assembly.webp"),
  계리직: require("../../assets/exam-types/post.webp"),
};

export function examTypeIcon(name: string): number | undefined {
  return EXAM_TYPE_ICONS[name];
}
