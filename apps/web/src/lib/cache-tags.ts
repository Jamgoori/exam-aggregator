// 'use cache' 엔트리에 붙이는 태그 이름. 캐시를 만드는 쪽과 갱신하는 쪽(서버 액션)이
// 같은 문자열을 쓰도록 한 곳에 둔다.

/** 문제지 상세페이지의 공개 데이터(정답표·CBT 가능·난이도 평균 등). */
export function paperDetailTag(paperId: string): string {
  return `paper-detail-${paperId}`;
}
