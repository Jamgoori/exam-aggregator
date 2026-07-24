// 웹 recordQuestionResults 포팅(공유). CBT·섞어풀기 채점이 모두 이걸 거쳐
// user_question_status 를 갱신한다(source 로 구분). wrong_count 는 증분이라 기존 값을
// 읽어 더한 뒤 upsert. 부가 집계라 실패해도 채점은 유효(호출부에서 try/catch).
// deno-lint-ignore-file no-explicit-any
export async function recordQuestionResults(
  admin: any,
  userId: string,
  paperId: string,
  results: { question_number: number; is_correct: boolean }[],
  source: "cbt" | "review",
): Promise<void> {
  if (results.length === 0) return;

  const { data: existing } = await admin
    .from("user_question_status")
    .select("question_number, wrong_count")
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  const priorWrong = new Map<number, number>(
    (existing ?? []).map((r: { question_number: number; wrong_count: number }) => [
      r.question_number,
      r.wrong_count ?? 0,
    ]),
  );

  const now = new Date().toISOString();
  const rows = results.map((r) => ({
    user_id: userId,
    paper_id: paperId,
    question_number: r.question_number,
    wrong_count: (priorWrong.get(r.question_number) ?? 0) + (r.is_correct ? 0 : 1),
    last_is_correct: r.is_correct,
    last_answered_at: now,
    source,
    updated_at: now,
  }));

  await admin
    .from("user_question_status")
    .upsert(rows, { onConflict: "user_id,paper_id,question_number" });
}
