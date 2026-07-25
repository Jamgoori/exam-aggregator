import { supabase } from "./supabase";
import { publicUrl } from "./storage";
import type { ExamPaper } from "@gongmoa/core";

// 웹의 all-papers / paper-search 데이터 접근을 앱용으로 얇게 옮긴 것.
// RLS·RPC 는 웹과 동일하게 그대로 재사용한다. 페이지네이션·정렬은 화면에서 필요할 때 확장.

// 목록 카드에 필요한 최소 컬럼. 전체 컬럼(file_path·tags·집계 등)을 다 받지 않아
// 전송량을 줄인다. 카드는 title·연도·회차·급수·과목명만 쓴다.
const LIST_COLUMNS =
  "id, title, year, round, level, track, subjects(id, name, slug)";

export async function listPapers(limit = 30): Promise<ExamPaper[]> {
  const { data, error } = await supabase
    .from("exam_papers")
    .select(LIST_COLUMNS)
    .order("year", { ascending: false })
    .order("round", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as ExamPaper[];
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
