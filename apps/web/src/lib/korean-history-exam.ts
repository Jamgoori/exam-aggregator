// 한국사능력검정시험(한능검)은 공무원 시험이 아니라서 과목 색인(ㄱㄴㄷ)의 자리
// 어디에도 맞지 않는다. 문제지는 전용 과목 행(아래 슬러그)에만 붙이고, 화면에서는
// 과목 색인 맨 앞의 전용 탭 하나로 들어간다.
//
// **공무원 "한국사" 과목과 섞지 않는 것이 요점이다.** 같은 과목 행에 붙이면 ㅎ 탭의
// "한국사"(국가직·지방직 기출)에 한능검 50문항짜리 문제지가 섞여 들어간다 — 공부
// 범위도 문항 수도 다른 시험이라 목록이 통째로 못 쓰게 된다. 그래서 과목을 따로 두고,
// 그 과목은 다시 초성 목록에서 감춘다(전용 탭이 이미 그 자리를 대신하므로, 두 군데에
// 보이면 "한국사"와 "한국사능력검정시험"이 ㅎ 탭에 나란히 떠 오히려 헷갈린다).
export const KHE_SUBJECT_SLUG = "korean-history-exam";
export const KHE_EXAM_TYPE_NAME = "한능검";
export const KHE_LEVEL = "심화";
export const KHE_TAB_LABEL = "한능검";

/**
 * 한능검 탭이 가는 곳 = 시험 허브(/exams/한능검-심화).
 *
 * 주소 규칙 자체는 lib/exam-index.ts(comboSlug + examHref)인데 그쪽은 `server-only`라
 * 클라이언트 컴포넌트인 과목 색인에서 못 부른다. 그래서 같은 규칙(시행처-급수, 한글이라
 * 반드시 인코딩)을 여기서 한 번 더 적되, 값은 위 상수에서 조립해 어긋나지 않게 한다.
 */
export function kheHref(): string {
  return `/exams/${encodeURIComponent(`${KHE_EXAM_TYPE_NAME}-${KHE_LEVEL}`)}`;
}

/** 과목 초성 목록에서 한능검 전용 과목을 뺀다. */
export function withoutKheSubject<T extends { slug: string }>(subjects: T[]): T[] {
  return subjects.filter((s) => s.slug !== KHE_SUBJECT_SLUG);
}
