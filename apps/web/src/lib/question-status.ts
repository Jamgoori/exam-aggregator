import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextSrs, srsStateFromRow, SRS_INITIAL } from "@gongmoa/core";
import { startTrialIfEligible } from "@/lib/membership";

export type QuestionResultInput = {
  question_number: number;
  is_correct: boolean;
};

type StatusRow = {
  question_number: number;
  wrong_count: number;
  // "하루 1회만 반영" 판정용 — 직전 채점이 오늘이면 정답이어도 간격을 안 벌린다.
  last_answered_at: string | null;
  srs_interval_days: number | null;
  srs_ease: number | null;
  srs_reps: number | null;
  srs_lapses: number | null;
};

// 응시 채점 결과를 문항 단위 통합 상태(user_question_status)에 반영한다. 오답노트
// "극복" 판정과 앞으로 나올 섞어풀기가 공유하는 테이블 — CBT 채점과 섞어풀기 채점이
// 모두 이 함수를 거친다(source로 구분).
//
// 쓰기는 service_role로만 한다: 예전엔 사용자 세션 클라이언트로 upsert했는데, 그러려면
// authenticated에 insert/update 정책을 열어둬야 해서 극복 여부·오답 횟수를 클라이언트가
// REST 호출로 직접 위조할 수 있었다. 서버가 채점한 결과만 이 테이블에 들어가야 하므로
// 쓰기 정책을 닫고(schema.sql) 여기서 admin 클라이언트를 쓴다. userId는 호출부(서버
// 액션)가 세션에서 검증한 본인 id만 넘긴다.
//
// wrong_count는 "틀린 채 제출된 횟수"라 증분이 필요하다. PostgREST upsert는 산술
// (col = col + n)을 못 하므로, 기존 값을 먼저 읽어 앱에서 더한 뒤 전체 행을 upsert한다.
// 문항 수십 개짜리 한 응시 기준이라 조회 1 + upsert 1로 충분하다. 동시 제출 경합은
// cbt_attempt_starts(응시당 1건 삭제)로 이미 막혀 실질적 위험이 없다.
//
// 같은 채점으로 간격 반복(SRS) 스케줄도 갱신한다. 복습 큐는 오답에서만 출발하므로
// 한 번도 틀린 적 없는 문항은 srs_due_at을 null로 둔다(큐에 안 들어옴). 계산은
// packages/core/srs.ts가 하고 여기는 결과만 쓴다 — 쓰기 정책이 없는 테이블이라
// 사용자가 자기 복습일을 미루거나 앞당길 수 없다. 직전 채점 시각을 함께 넘겨
// "같은 날 다시 맞힌 것"으로 간격이 벌어지지 않게 한다(섞어풀기는 쿨다운이 없어
// 하루에 같은 문항을 여러 번 낼 수 있다).
//
// 부가 집계이므로 실패해도 채점 자체는 막지 않는다 — 호출부에서 try/catch로 삼킨다.
// (마이그레이션 적용 전이라 테이블이 없어도 조용히 무시되게 하려는 의도이기도 하다.)
export async function recordQuestionResults(
  userId: string,
  paperId: string,
  results: QuestionResultInput[],
  source: "cbt" | "review" = "cbt",
): Promise<void> {
  if (results.length === 0) return;

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("user_question_status")
    .select(
      "question_number, wrong_count, last_answered_at, srs_interval_days, srs_ease, srs_reps, srs_lapses",
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

    // 한 번도 틀린 적 없는 문항은 SRS에 넣지 않는다(due는 계속 null).
    const srs = wrongCount > 0
      ? nextSrs(
          before ? srsStateFromRow(before) : SRS_INITIAL,
          r.is_correct,
          at,
          before?.last_answered_at ? new Date(before.last_answered_at) : null,
        )
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
      await startTrialIfEligible(userId);
    } catch {
      // 무시: 체험 시작 실패가 채점을 막지 않는다.
    }
  }
}
