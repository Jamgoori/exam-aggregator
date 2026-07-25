import type { ExamPaper } from "@gongmoa/core";
import { browsePapers } from "./papers";

// 검색 탭. 홈 목록과 같은 경로(browsePapers)를 써서 검색 규칙이 두 벌이 되지 않게 한다
// — 파싱·과목 매칭은 @gongmoa/core, 필터는 서버 쿼리.
export async function searchPapers(rawQuery: string): Promise<ExamPaper[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];
  const { papers } = await browsePapers({ query: trimmed }, 0);
  return papers;
}
