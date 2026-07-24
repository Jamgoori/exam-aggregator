import { matchSubjectIds, parseSearchQuery } from "@gongmoa/core";
import { supabase } from "./supabase";
import type { ExamPaper, Subject } from "@gongmoa/core";

// 웹은 전체 목록(3천여 건)을 클라이언트로 받아 필터한다. 모바일은 전송량이 부담이라
// 서버 쿼리로 좁힌다: 과목(초성 포함)·제목·급수·연도로 필터. 웹 paper-search.ts 의
// matchSubjectIds / parseSearchQuery 규칙을 그대로 옮겨 결과가 어긋나지 않게 한다.

// 과목 목록은 작아서(약 160개) 한 번 받아 캐시한다.
let subjectsCache: Subject[] | null = null;
async function getSubjects(): Promise<Subject[]> {
  if (subjectsCache) return subjectsCache;
  const { data, error } = await supabase.from("subjects").select("*").order("name");
  if (error) throw error;
  subjectsCache = (data ?? []) as Subject[];
  return subjectsCache;
}

// matchSubjectIds / parseSearchQuery 는 @gongmoa/core 로 단일화(웹과 공유).

export async function searchPapers(rawQuery: string): Promise<ExamPaper[]> {
  const trimmed = rawQuery.trim();
  if (!trimmed) return [];

  const { level, year, subjectQuery } = parseSearchQuery(trimmed);
  const subjects = await getSubjects();
  const matchedSubjectIds = subjectQuery
    ? matchSubjectIds(subjects, subjectQuery)
    : [];

  // 텍스트만 있고 매칭 과목이 없고 급수/연도도 없으면 결과 없음.
  if (matchedSubjectIds.length === 0 && !subjectQuery && !level && !year) {
    return [];
  }

  let query = supabase
    .from("exam_papers")
    .select("id, title, year, round, level, subjects(id, name, slug)")
    .order("year", { ascending: false })
    .order("round", { ascending: false })
    .limit(100);

  if (matchedSubjectIds.length > 0) {
    query = query.in("subject_id", matchedSubjectIds);
  } else if (subjectQuery) {
    // 매칭 과목이 없으면 제목 부분 일치로 폴백.
    query = query.ilike("title", `%${subjectQuery}%`);
  }
  if (level) query = query.eq("level", level);
  if (year) query = query.eq("year", year);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ExamPaper[];
}
