import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { nextSrs, srsDayIndex, srsStateFromRow, SRS_INITIAL } from "@gongmoa/core";
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
  // null이면 아직 SRS에 안 태운 문항(대기 풀). 여기서 스케줄을 심지 않는다.
  srs_due_at: string | null;
  srs_interval_days: number | null;
  srs_ease: number | null;
  srs_reps: number | null;
  srs_lapses: number | null;
  // leech로 접어둔 시각. 채점할 때마다 그대로 다시 써서 값을 잃지 않게 한다.
  srs_suspended_at: string | null;
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

    // 스케줄은 이미 SRS에 올라탄 문항만 굴린다. 새 오답은 대기 풀에 남겨 두고
    // (srs_due_at = null), 복습 세션을 시작할 때 하루 신규 몫만큼만 승격한다
    // (review-queue.ts). 여기서 태우면 하루 80개씩 틀리는 1회독 사용자의 큐가
    // 유입 속도대로 불어나 손댈 수 없게 된다. 대기 문항을 섞어풀기로 풀어도
    // 마찬가지 — 세션 한 번으로 신규 몫이 무력화되면 안 된다.
    //
    // 저장된 예약 시각(srs_due_at)을 함께 넘긴다. 이 서비스의 채점은 복습 세션에서만
    // 일어나지 않는다 — 회독(문제지 통째 재응시)과 섞어풀기가 스케줄과 무관하게 같은
    // 문항을 다시 채점한다. 그걸 예정된 복습과 똑같이 처리하면 간격 62일짜리가 5일
    // 만에 맞혔다고 174일로 뛰거나, 5일 만에 틀렸다고 1일로 리셋되고 leech까지
    // 진행된다. 판단은 srs.ts가 하고 여기는 재료만 준다.
    const srs =
      before?.srs_due_at != null
        ? nextSrs(
            srsStateFromRow(before),
            r.is_correct,
            at,
            before.last_answered_at ? new Date(before.last_answered_at) : null,
            { dueAt: new Date(before.srs_due_at), fuzz: Math.random },
          )
        : null;

    // 대기 중이면 스케줄 컬럼을 그대로 둔다(초기값 유지). 승격 시점부터 1일 → 3일로
    // 정상 출발하게 하려는 것 — 간격 없이 맞힌 건 유지력이 아니다.
    //
    // leech 판정에 걸리면 접는다(srs_suspended_at). 스케줄은 지우지 않아서 다시
    // 넣을 때 진도를 잃지 않는다. 이미 접힌 문항은 그 값을 그대로 유지한다 —
    // 섞어풀기로 그 문항을 맞혀도 자동으로 풀리면 안 된다(되살리기는 수동).
    //
    // 모든 행이 같은 키를 갖게 하는 게 중요하다. PostgREST는 배열 upsert에서 키가
    // 다른 객체가 섞이면 요청 전체를 거절한다 — 한 문항이 leech에 걸렸다는 이유로
    // 그 응시의 상태 갱신이 통째로 날아가면 안 된다.
    // 이 채점이 무엇을 검증했는지 남긴다. 상태만 덮어쓰면 "간격 8일에서 실제
    // 정답률이 몇 %였나"를 영영 셀 수 없고, 그러면 ease·학습 단계·점수 상한이
    // 맞는 값인지 확인할 방법이 없다.
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

  // 이력은 순수 부가 기록이라 실패해도 조용히 넘긴다(마이그레이션 전이면 테이블이
  // 없다). 스케줄 갱신이 이미 끝난 뒤라 여기서 던져도 얻을 게 없다.
  if (reviewLog.length > 0) {
    try {
      await admin.from("srs_reviews").insert(reviewLog);
    } catch {
      // 무시
    }
  }

  // 무료 기간은 가입 순간에 켜지지만(로그인 콜백·getMembership), 그 두 경로를 모두
  // 비껴간 계정이 남을 수 있어 채점 때도 한 번 확인한다. 이미 켠 계정은 안에서
  // 0행 갱신으로 끝나므로 채점할 때마다 기간이 늘어나지 않는다.
  if (source === "cbt") {
    try {
      await startTrialIfEligible(userId);
    } catch {
      // 무시: 무료 기간 시작 실패가 채점을 막지 않는다.
    }
  }
}
