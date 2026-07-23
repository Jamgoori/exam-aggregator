import { supabase } from "./supabase";
import type { ExamPaper } from "./types";

// 웹의 all-papers / paper-search 데이터 접근을 앱용으로 얇게 옮긴 것.
// RLS·RPC 는 웹과 동일하게 그대로 재사용한다. 페이지네이션·정렬은 화면에서 필요할 때 확장.

export async function listPapers(limit = 30): Promise<ExamPaper[]> {
  const { data, error } = await supabase
    .from("exam_papers")
    .select("*, subjects(*), exam_types(*)")
    .order("year", { ascending: false })
    .order("round", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as ExamPaper[];
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

// 문항별 크롭 이미지 (CBT "문제별 보기"용). 웹 cbt/page.tsx 와 동일 구조.
export async function getQuestionImages(
  paperId: string,
): Promise<Record<number, string[]>> {
  const { data, error } = await supabase
    .from("questions")
    .select("question_number, question_images(order_index, image_path)")
    .eq("paper_id", paperId)
    .order("question_number");
  if (error) throw error;

  const result: Record<number, string[]> = {};
  for (const row of data ?? []) {
    const images = [...((row.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => img.image_path);
    if (images.length > 0) {
      result[row.question_number as number] = images;
    }
  }
  return result;
}
