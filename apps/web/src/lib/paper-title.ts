// 제목 표시 규칙은 @gongmoa/core 로 단일화(모바일과 공유). 재노출.
export {
  stripTrackFromTitle,
  getPaperDisplayTitle,
  getPaperDocumentTitle,
} from "@gongmoa/core";
// 시행처가 다르게 부르는 과목명(군무원 행정법총론 → 행정법)도 같은 층의 규칙이다.
export { getSubjectDisplayName, applyExamTypeSubjectName } from "@gongmoa/core";
