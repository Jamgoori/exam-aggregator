import { supabase } from "./supabase";

// 문항 메모(question_memos). RLS 본인 CRUD. pk=(user_id, paper_id, question_number).
export async function getMemo(paperId: string, questionNumber: number): Promise<string> {
  const { data } = await supabase
    .from("question_memos")
    .select("memo")
    .eq("paper_id", paperId)
    .eq("question_number", questionNumber)
    .maybeSingle();
  return (data?.memo as string | undefined) ?? "";
}

export async function saveMemo(
  paperId: string,
  questionNumber: number,
  memo: string,
): Promise<void> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error("로그인이 필요해요.");

  const trimmed = memo.trim();
  if (!trimmed) {
    // 빈 메모는 삭제(컬럼이 NOT NULL 이라 빈 값 저장 불가).
    await supabase
      .from("question_memos")
      .delete()
      .eq("paper_id", paperId)
      .eq("question_number", questionNumber);
    return;
  }

  const { error } = await supabase.from("question_memos").upsert(
    {
      user_id: userId,
      paper_id: paperId,
      question_number: questionNumber,
      memo: trimmed,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) throw error;
}
