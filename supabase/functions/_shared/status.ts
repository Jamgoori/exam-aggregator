// 웹 recordQuestionResults 포팅(공유). CBT·섞어풀기 채점이 모두 이걸 거쳐
// user_question_status 를 갱신한다(source 로 구분). wrong_count 는 증분이라 기존 값을
// 읽어 더한 뒤 upsert. 부가 집계라 실패해도 채점은 유효(호출부에서 try/catch).
//
// 같은 채점으로 간격 반복(SRS) 스케줄도 갱신한다. 복습 큐는 오답에서만 출발하므로
// 한 번도 틀린 적 없는 문항은 srs_due_at 을 null 로 둔다(큐에 안 들어옴).
// deno-lint-ignore-file no-explicit-any
import { nextSrs, srsDayIndex, SRS_INITIAL, srsStateFromRow } from "./srs.ts";
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
  // leech 로 접어둔 시각. 채점할 때마다 그대로 다시 써서 값을 잃지 않게 한다.
  srs_suspended_at: string | null;
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
      "question_number, wrong_count, last_answered_at, srs_due_at, srs_interval_days, srs_ease, srs_reps, srs_lapses, srs_suspended_at",
    )
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  const prior = new Map<number, StatusRow>(
    ((existing ?? []) as StatusRow[]).map((r) => [r.question_number, r]),
  );

  const at = new Date();
  const now = at.toISOString();

  // 복습 이력. 스케줄이 있는 문항의 채점만 담는다(대기 풀 오답은 아직 복습이 아니다).
  const reviewLog: Record<string, unknown>[] = [];

  const rows = results.map((r) => {
    const before = prior.get(r.question_number);
    const wrongCount = (before?.wrong_count ?? 0) + (r.is_correct ? 0 : 1);

    // 스케줄은 이미 SRS 에 올라탄 문항만 굴린다. 새 오답은 대기 풀(srs_due_at =
    // null)에 남고, 복습 세션 시작 시 하루 신규 몫만큼만 승격된다. 근거는 웹
    // question-status.ts 주석 참고.
    //
    // srs_due_at 을 함께 넘겨 "예정된 복습"과 "회독·섞어풀기가 끌어온 조기 채점"을
    // 구분한다. 안 그러면 회독할수록 스케줄이 망가진다.
    const srs = before?.srs_due_at != null
      ? nextSrs(
        srsStateFromRow(before),
        r.is_correct,
        at,
        before.last_answered_at ? new Date(before.last_answered_at) : null,
        { dueAt: new Date(before.srs_due_at), fuzz: Math.random },
      )
      : null;

    // 이 채점이 무엇을 검증했는지 남긴다(간격 구간별 실제 유지율 측정용).
    if (srs && before) {
      const prevState = srsStateFromRow(before);
      reviewLog.push({
        user_id: userId,
        paper_id: paperId,
        question_number: r.question_number,
        reviewed_at: now,
        is_correct: r.is_correct,
        source,
        prev_interval_days: prevState.intervalDays,
        prev_ease: prevState.ease,
        prev_reps: prevState.reps,
        prev_lapses: prevState.lapses,
        elapsed_days: before.last_answered_at
          ? srsDayIndex(at) - srsDayIndex(new Date(before.last_answered_at))
          : null,
        next_interval_days: srs.state.intervalDays,
      });
    }

    // leech 판정에 걸리면 접는다(srs_suspended_at). 스케줄은 지우지 않고, 이미
    // 접힌 문항은 그 값을 유지한다(되살리기는 수동).
    //
    // 모든 행이 같은 키를 갖게 한다 — PostgREST 는 배열 upsert 에서 키가 다른
    // 객체가 섞이면 요청 전체를 거절한다.
    const suspendedAt = srs?.leech ? now : (before?.srs_suspended_at ?? null);
    const schedule = srs
      ? {
        srs_interval_days: srs.state.intervalDays,
        srs_ease: srs.state.ease,
        srs_reps: srs.state.reps,
        srs_lapses: srs.state.lapses,
        srs_due_at: srs.dueAt.toISOString(),
        srs_suspended_at: suspendedAt,
      }
      : {
        srs_interval_days: before?.srs_interval_days ?? SRS_INITIAL.intervalDays,
        srs_ease: before?.srs_ease ?? SRS_INITIAL.ease,
        srs_reps: before?.srs_reps ?? SRS_INITIAL.reps,
        srs_lapses: before?.srs_lapses ?? SRS_INITIAL.lapses,
        srs_due_at: null,
        srs_suspended_at: suspendedAt,
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

  // 이력은 부가 기록이라 실패해도 조용히 넘긴다(마이그레이션 전이면 테이블이 없다).
  if (reviewLog.length > 0) {
    try {
      await admin.from("srs_reviews").insert(reviewLog);
    } catch {
      // 무시
    }
  }

  // 무료 기간은 가입 순간에 켜지지만(웹 로그인 콜백·isPremiumUser), 그 경로를 비껴간
  // 계정이 남을 수 있어 채점 때도 한 번 확인한다. 이미 켠 계정은 안에서 0행 갱신으로
  // 끝나므로 채점할 때마다 기간이 늘어나지 않는다.
  if (source === "cbt") {
    try {
      await startTrialIfEligible(admin, userId);
    } catch {
      // 무시: 무료 기간 시작 실패가 채점을 막지 않는다.
    }
  }
}
