// 직렬(track)은 데이터 구분과 중복 판정에는 필요하지만, 법원직 문제지의 화면 제목에는
// 표시하지 않는다. 공통·전공 과목 모두 과목명만으로 제목을 일관되게 보여 준다.
export function stripTrackFromTitle(
  title: string,
  track: string | null | undefined,
): string {
  if (!track) return title;
  return title.replace(` (${track})`, "").replace(/\s{2,}/g, " ").trim();
}

export function getPaperDisplayTitle(
  title: string,
  track: string | null | undefined,
): string {
  return title.includes(" 법원직 ") ? stripTrackFromTitle(title, track) : title;
}
