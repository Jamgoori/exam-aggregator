import { supabase } from "./supabase";
import { publicUrl } from "./storage";
import { matchSubjectIds, parseSearchQuery } from "@gongmoa/core";
import type { ExamPaper, Subject } from "@gongmoa/core";

// 웹의 all-papers / paper-search 데이터 접근을 앱용으로 얇게 옮긴 것.
// RLS·RPC 는 웹과 동일하게 그대로 재사용한다. 페이지네이션·정렬은 화면에서 필요할 때 확장.

// 목록 카드에 필요한 최소 컬럼. 전체 컬럼(file_path·tags·집계 등)을 다 받지 않아
// 전송량을 줄인다. 카드는 title·연도·회차·급수·과목명만 쓴다.
const LIST_COLUMNS =
  "id, title, year, round, level, track, subjects(id, name, slug)";

// ── 홈 목록(검색·급수 필터·페이지네이션) ──────────────────────────────────────
//
// 웹 홈은 문제지 전체(3천여 건)를 클라이언트로 내려 브라우저에서 필터한다. 앱은 전송량과
// 메모리가 부담이라 같은 규칙(@gongmoa/core 의 parseSearchQuery/matchSubjectIds)을 쓰되
// 필터를 서버 쿼리로 내리고 페이지 단위로 받는다.

export const PAGE_SIZE = 20;

// 과목(약 160개)·시행처(14개)는 작고 잘 안 변해서 한 번 받아 캐시한다.
let subjectsCache: Subject[] | null = null;
let examTypeNamesCache: string[] | null = null;

async function getSubjects(): Promise<Subject[]> {
  if (subjectsCache) return subjectsCache;
  const { data, error } = await supabase.from("subjects").select("*").order("name");
  if (error) throw error;
  subjectsCache = (data ?? []) as Subject[];
  return subjectsCache;
}

async function getExamTypeNames(): Promise<string[]> {
  if (examTypeNamesCache) return examTypeNamesCache;
  const { data } = await supabase.from("exam_types").select("name");
  examTypeNamesCache = (data ?? []).map((r) => r.name as string);
  return examTypeNamesCache;
}

export type BrowseResult = { papers: ExamPaper[]; hasMore: boolean };

// page 는 0부터. 검색어가 비어 있으면 최신순 전체 목록이다.
export async function browsePapers(
  { query = "", level }: { query?: string; level?: string },
  page = 0,
): Promise<BrowseResult> {
  const trimmed = query.trim();

  let q = supabase
    .from("exam_papers")
    .select(LIST_COLUMNS)
    .order("year", { ascending: false })
    .order("round", { ascending: false })
    .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  // 탭으로 고른 급수가 검색어 안의 급수보다 우선한다(사용자가 방금 누른 값이라).
  let effectiveLevel = level;

  if (trimmed) {
    const [subjects, examTypeNames] = await Promise.all([
      getSubjects(),
      getExamTypeNames(),
    ]);
    const parsed = parseSearchQuery(trimmed, examTypeNames);
    effectiveLevel = level ?? parsed.level;

    const matchedSubjectIds = parsed.subjectQuery
      ? matchSubjectIds(subjects, parsed.subjectQuery)
      : [];

    if (matchedSubjectIds.length > 0) {
      q = q.in("subject_id", matchedSubjectIds);
    } else if (parsed.subjectQuery) {
      // 매칭되는 과목이 없으면 제목 부분 일치로 폴백(웹 검색과 같은 순서).
      q = q.ilike("title", `%${parsed.subjectQuery}%`);
    }
    if (parsed.year) q = q.eq("year", parsed.year);
    if (parsed.examType) {
      const { data: types } = await supabase
        .from("exam_types")
        .select("id")
        .eq("name", parsed.examType);
      const typeId = types?.[0]?.id;
      if (typeId) q = q.eq("exam_type_id", typeId);
    }
  }

  if (effectiveLevel) q = q.eq("level", effectiveLevel);

  const { data, error } = await q;
  if (error) throw error;
  const papers = (data ?? []) as unknown as ExamPaper[];
  // 요청한 페이지가 꽉 찼으면 다음 페이지가 있을 수 있다고 본다(총 개수 조회 생략).
  return { papers, hasMore: papers.length === PAGE_SIZE };
}

// 문제지별 내 회독 수(= CBT 응시 횟수). 홈 카드의 회독 배지에 쓴다. RLS 로 본인 것만.
export async function getMyRoundCounts(): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data, error } = await supabase.from("cbt_attempts").select("paper_id");
  if (error) return counts;
  for (const r of data ?? []) {
    const id = r.paper_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function getPaper(id: string): Promise<ExamPaper | null> {
  const { data, error } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data as ExamPaper | null;
}

export async function hasCbtAnswers(paperId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("has_cbt_answers", {
    target_paper_id: paperId,
  });
  if (error) throw error;
  return Boolean(data);
}

export type CbtQuestionData = {
  // 문항번호 → 공개 이미지 URL 배열 (문제별 보기용). 세트문제는 같은 URL 배열 공유.
  questionImages: Record<number, string[]>;
  // 문항번호 → 선택지 수 (진위형 등 문항별로 다를 수 있어 개별 저장).
  questionChoiceCounts: Record<number, number>;
};

// 문항별 크롭 이미지 + 선택지 수 (CBT "문제별 보기"용). 웹 cbt/page.tsx 와 동일 구조.
// 이미지 경로는 여기서 공개 URL 로 변환해 화면은 URL 만 다룬다.
export async function getCbtQuestionData(
  paperId: string,
): Promise<CbtQuestionData> {
  const { data, error } = await supabase
    .from("questions")
    .select(
      "question_number, choice_count, question_images(order_index, image_path)",
    )
    .eq("paper_id", paperId)
    .order("question_number");
  if (error) throw error;

  const questionImages: Record<number, string[]> = {};
  const questionChoiceCounts: Record<number, number> = {};
  for (const row of data ?? []) {
    const images = [...((row.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => publicUrl(img.image_path));
    if (images.length === 0) continue;
    const n = row.question_number as number;
    questionImages[n] = images;
    questionChoiceCounts[n] = row.choice_count as number;
  }
  return { questionImages, questionChoiceCounts };
}
