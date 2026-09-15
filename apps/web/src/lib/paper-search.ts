// 검색어 파싱/과목 매칭과 문제지 목록의 압축 표현(PaperWire)·필터·묶음 계산은 전부
// @gongmoa/core 로 단일화(모바일 /papers 화면과 공유 — packages/core/src/data/papers.ts).
// 기존 import 경로를 그대로 쓰도록 재노출한다.
export {
  matchSubjectIds,
  parseSearchQuery,
  encodePapers,
  decodePapers,
  getExamTypeNames,
  filterPapers,
  groupByYearAndSubject,
  type PaperCore,
  type LightPaper,
  type PaperWire,
  type ExamTypeRef,
  type HomePayload,
} from "@gongmoa/core";
