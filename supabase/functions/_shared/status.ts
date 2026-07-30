// 웹 recordQuestionResults 포팅(공유). CBT·섞어풀기 채점이 모두 이걸 거쳐
// user_question_status 를 갱신한다(source 로 구분). wrong_count 는 증분이라 기존 값을
// 읽어 더한 뒤 upsert. 부가 집계라 실패해도 채점은 유효(호출부에서 try/catch).
//
// 같은 채점으로 간격 반복(SRS) 스케줄도 갱신한다. 복습 큐는 오답에서만 출발하므로
// 한 번도 틀린 적 없는 문항은 srs_due_at 을 null 로 둔다(큐에 안 들어옴).
// deno-lint-ignore-file no-explicit-any
import { nextSrs, SRS_INITIAL, srsStateFromRow } from "./srs.ts";
import { startTrialIfEligible } from "./membership.ts";

type StatusRow = {
  question_number: number;
  wrong_count: number;
  srs_interval_days: number | null;
  srs_ease: number | null;
  srs_reps: number | null;
  srs_lapses: number | null;
};

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
    .select(
      "question_number, wrong_count, srs_interval_days, srs_ease, srs_reps, srs_lapses",
    )
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  const prior = new Map<number, StatusRow>(
    ((existing ?? []) as StatusRow[]).map((r) => [r.question_number, r]),
  );

  const at = new Date();
  const now = at.toISOString();
  const rows = results.map((r) => {
    const before = prior.get(r.question_number);
    const wrongCount = (before?.wrong_count ?? 0) + (r.is_correct ? 0 : 1);

    // 한 번도 틀린 적 없는 문항은 SRS 에 넣지 않는다(due 는 계속 null).
    const srs = wrongCount > 0
      ? nextSrs(before ? srsStateFromRow(before) : SRS_INITIAL, r.is_correct, at)
      : null;

    return {
      user_id: userId,
      paper_id: paperId,
      question_number: r.question_number,
      wrong_count: wrongCount,
      last_is_correct: r.is_correct,
      last_answered_at: now,
      source,
      updated_at: now,
      srs_interval_days: srs?.state.intervalDays ?? SRS_INITIAL.intervalDays,
      srs_ease: srs?.state.ease ?? SRS_INITIAL.ease,
      srs_reps: srs?.state.reps ?? SRS_INITIAL.reps,
      srs_lapses: srs?.state.lapses ?? SRS_INITIAL.lapses,
      srs_due_at: srs?.dueAt.toISOString() ?? null,
    };
  });

  await admin
    .from("user_question_status")
    .upsert(rows, { onConflict: "user_id,paper_id,question_number" });

  // 체험은 첫 CBT 채점에 켠다(가입일 기준이 아니라). 섞어풀기 채점은 이미 오답이
  // 있다는 뜻이라 시작점으로 삼지 않는다.
  if (source === "cbt") {
    try {
      await startTrialIfEligible(admin, userId);
    } catch {
      // 무시: 체험 시작 실패가 채점을 막지 않는다.
    }
  }
}
