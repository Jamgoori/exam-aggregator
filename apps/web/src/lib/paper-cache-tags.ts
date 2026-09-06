// 문제지 하나의 공개 데이터(댓글·난이도 평균·정답표 등)에 붙는 캐시 태그.
//
// 읽는 쪽은 app/papers/[id]/paper-detail-data.ts 의 fetchPaperPublicData('use cache'),
// 끊는 쪽은 app/papers/actions.ts 의 revalidatePaperPath 다. 서버 액션 파일이 라우트
// 폴더(`[id]`)를 import 하지 않도록 태그 이름만 여기 따로 둔다.
export function paperPublicTag(paperId: string) {
  return `paper-public:${paperId}`;
}
