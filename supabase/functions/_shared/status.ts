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
  // "하루 1회만 반영" 판정용 — 직전 채점이 오늘이면 정답이어도 간격을 안 벌린다.
  last_answered_at: string | null;
  // null이면 아직 SRS 에 안 태운 문항(대기 풀). 여기서 스케줄을 심지 않는다.
  srs_due_at: string | null;
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
      "question_number, wrong_count, last_answered_at, srs_due_at, srs_interval_days, srs_ease, srs_reps, srs_lapses",
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

    // 스케줄은 이미 SRS 에 올라탄 문항만 굴린다. 새 오답은 대기 풀(srs_due_at =
    // null)에 남고, 복습 세션 시작 시 하루 신규 몫만큼만 승격된다. 근거는 웹
    // question-status.ts 주석 참고.
    const srs = before?.srs_due_at != null
      ? nextSrs(
        srsStateFromRow(before),
        r.is_correct,
        at,
        before.last_answered_at ? new Date(before.last_answered_at) : null,
      )
      : null;

    const schedule = srs
      ? {
        srs_interval_days: srs.state.intervalDays,
        srs_ease: srs.state.ease,
        srs_reps: srs.state.reps,
        srs_lapses: srs.state.lapses,
        srs_due_at: srs.dueAt.toISOString(),
      }
      : {
        srs_interval_days: before?.srs_interval_days ?? SRS_INITIAL.intervalDays,
        srs_ease: before?.srs_ease ?? SRS_INITIAL.ease,
        srs_reps: before?.srs_reps ?? SRS_INITIAL.reps,
        srs_lapses: before?.srs_lapses ?? SRS_INITIAL.lapses,
        srs_due_at: null,
      };

    return {
      user_id: userId,
      paper_id: paperId,
      question_number: r.question_number,
      wrong_count: wrongCount,
      last_is_correct: r.is_correct,
      last_answered_at: now,
      source,
      updated_at: now,
      ...schedule,
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
