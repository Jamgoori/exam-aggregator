// 문제지 제목 표시 규칙 — 웹·모바일 공유(순수 함수).
//
// 웹 src/lib/paper-title.ts 가 정본이었고, 모바일은 아직 원본 title 을 그대로 그리고
// 있어서 같은 문제지가 웹과 앱에서 다른 이름으로 보였다. 여기로 올려 양쪽이 같은
// 규칙을 쓴다.

import { applyExamTypeSubjectName } from "./subject-label";

// 직렬(track)은 데이터 구분과 중복 판정에는 필요하지만, 법원직 문제지의 화면 제목에는
// 표시하지 않는다. 공통·전공 과목 모두 과목명만으로 제목을 일관되게 보여 준다.
export function stripTrackFromTitle(
  title: string,
  track: string | null | undefined,
): string {
  if (!track) return title;
  return title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim();
}

// 화면에 보여줄 제목에서는 괄호 표기를 없애고 안의 텍스트만 남긴다.
// ex) "2024 경찰 (간부후보) 1차" -> "2024 경찰 간부후보 1차"
function unwrapParentheses(title: string): string {
  return title
    .replace(/[(（]([^()（）]*)[)）]/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getPaperDisplayTitle(
  title: string,
  track: string | null | undefined,
): string {
  // 시행처가 다르게 부르는 과목은 그 시행처 표기로 되돌린다(군무원 행정법총론 →
  // 행정법). 저장된 제목이 아니라 화면에 나갈 이름만 바뀐다 — subject-label.ts 참고.
  const named = applyExamTypeSubjectName(title);
  const base = named.includes(" 법원직 ")
    ? stripTrackFromTitle(named, track)
    : named;
  return unwrapParentheses(base);
}
