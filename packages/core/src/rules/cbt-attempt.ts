import type { SupabaseClient } from "@supabase/supabase-js";
import { attendanceQuestionCount } from "../attendance";
import { formatDuration } from "../format";
import { MIN_ATTEMPT_SECONDS, sanitizeSelectedChoice } from "../cbt-attempt";
import { recordQuestionResults, type RecordQuestionResultsOptions } from "./question-status";
import { recordAttendance } from "./attendance-record";

// CBT 응시(시작 기록·채점·기록)의 서버 규칙. 웹 서버 액션(papers/actions.ts 의
// startCbtAttempt/submitCbtAttempt)과 Edge Function(cbt-start/cbt-submit)이 이 두 함수의
// 얇은 어댑터다 — 예전엔 양쪽에 같은 코드가 한 벌씩 있었다.
//
// 채점은 반드시 service_role 로만 한다 — 정답(paper_answers)은 RLS 로 클라이언트에
// 완전 차단돼 있고, 시작시각·점수 위조를 막기 위해 쓰기(cbt_attempts/cbt_attempt_answers/
// cbt_attempt_starts)도 전부 service_role 이다. 사용자 세션 쓰기를 허용하면 클라이언트가
// REST 호출로 점수·시작시각을 위조해 회독 배지와 공개 통계(회차별 평균, 전국 오답률, 총
// 응시 수)를 오염시킬 수 있다. 본인 확인은 호출부(세션 검사)가 끝내고 userId 만 넘긴다.

// 순수 규칙(클라이언트도 쓰는 값)은 ../cbt-attempt.ts 에 있고 여기서 다시 내보낸다.
export { MIN_ATTEMPT_SECONDS, sanitizeSelectedChoice } from "../cbt-attempt";

export type CbtQuestionResult = {
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

export type CbtRuleError = { error: string; status: 400 | 500 };

export type CbtStartResult = { startedAt: string } | CbtRuleError;

export type CbtSubmitSuccess = {
  attemptId: string;
  score: number;
  totalQuestions: number;
  durationSeconds: number;
  voidedQuestions: number[];
  questionResults: CbtQuestionResult[];
  // 결과 모달의 "AI 약점 진단까지 응시 N/3" 진행 바용. 이번 응시까지 포함한 누적
  // 응시 수와 한 번이라도 틀린 문항 수(getDiagnosisEligibility 와 같은 기준).
  // 집계에 실패하면 빠지고, 모달은 그 줄을 그리지 않는다.
  diagnosisProgress?: { attemptCount: number; wrongCount: number };
};

export type CbtSubmitResult = CbtSubmitSuccess | CbtRuleError;

export function isCbtRuleError(r: CbtStartResult | CbtSubmitResult): r is CbtRuleError {
  return "error" in r;
}

// 회독 배지가 "제출 횟수"만 세다 보니, 페이지 진입 직후 아무것도 안 풀고 연타로
// 제출해 회독수만 올리는 게 가능했다. 클라이언트가 보내는 durationSeconds는 조작
// 가능해서 신뢰할 수 없으므로, 여기서 서버에 직접 기록해 둔 시작 시각과
// 현재 시각의 차이로만 최소 응시시간을 검증한다.
//
// 이 함수가 기록하는 시각을 그대로 응답에 실어 돌려준다 — 클라이언트가 이 응답을
// 기다리지 않고 자기 시계로 먼저 타이머를 시작해버리면, 그 사이의 네트워크 지연
// (드물게는 수십 초까지도)만큼 서버 기준 최소 응시시간(MIN_ATTEMPT_SECONDS)이
// 클라이언트가 보는 화면보다 항상 늦게 끝나서 실제로는 그보다 더 기다려야
// 제출되는 문제가 생긴다. 클라이언트는 반드시 이 응답의 startedAt을 기준시각으로
// 써야 이 차이가 사라진다.
//
// started_at은 반드시 서버(service_role)만 쓴다. 사용자 세션으로 쓰게 하면
// authenticated insert/update 정책이 필요해지고, 그 정책이 있으면 클라이언트가
// REST 호출로 started_at을 과거로 조작해 최소 응시시간 검증을 통째로 우회할 수 있다.
//
// (user_id, paper_id) upsert 라 재시작은 started_at 을 덮는다 — 웹·앱에서 같은 문제지를
// 동시에 시작하면 나중 시작이 이긴다(설계서 §6.6, 허용 동작).
export async function startCbtAttempt(
  admin: SupabaseClient,
  userId: string,
  paperId: string,
  now: Date = new Date(),
): Promise<CbtStartResult> {
  const startedAt = now.toISOString();
  const { error } = await admin
    .from("cbt_attempt_starts")
    .upsert(
      { user_id: userId, paper_id: paperId, started_at: startedAt },
      { onConflict: "user_id,paper_id" },
    );
  if (error) return { error: "시작 기록에 실패했어요.", status: 500 };
  return { startedAt };
}

export type SubmitCbtAttemptOptions = {
  now?: Date;
  // recordQuestionResults 로 그대로 넘긴다(테스트용 fuzz·startTrial 주입).
  questionStatus?: RecordQuestionResultsOptions;
  // 응답의 diagnosisProgress 집계를 건너뛴다(집계 두 번을 아끼려는 호출부용).
  skipDiagnosisProgress?: boolean;
};

// 제출 답안을 채점해 응시·문항별 답안을 기록하고, 문항 상태(오답노트)와 출석에 반영한다.
//
// 순서가 중요하다(설계서 §6.6 "CBT 이중 제출"):
//   1) 정답 조회(읽기만) — 정답이 없으면 채점할 것이 없다.
//   2) **시작 행을 원자적으로 회수한다** — delete … returning started_at. 0행이면 즉시
//      거절. 예전엔 select 로 확인한 뒤 채점을 다 끝내고 말미에 delete 했는데, 그러면
//      웹+앱 동시 제출이나 앱 타임아웃 재시도가 겹칠 때 둘 다 통과해 cbt_attempts 2행,
//      recordQuestionResults 2회(wrong_count +2·srs_reviews 중복), record_attendance_day
//      2회(출석 문항 누계 두 배 → 멤버십 일수 환전)가 됐다. 회수에 성공한 요청만
//      채점·상태·출석을 수행하므로 두 기기가 동시에 제출하면 한쪽만 채점된다.
//   3) 최소 응시시간 검사. 걸리면 거절하되 **시작 행을 같은 started_at 으로 되돌려
//      놓는다** — 예전엔 행이 그대로 남아 있어 잠시 뒤 다시 제출하면 됐고, 그 UX
//      ("N초 후에 다시 시도해주세요")를 그대로 유지하려는 것. 되돌린 행은 원래 시각을
//      그대로 가지므로 대기 시간이 늘어나지 않는다.
//   4) 채점 → cbt_attempts/cbt_attempt_answers 기록. 기록에 실패하면 3)과 같은 이유로
//      시작 행을 되돌린다(예전엔 실패 시 행이 남아 재시도가 됐다).
//   5) 문항 상태·출석·진단 진행률 — 부가 처리라 실패해도 채점 결과는 돌려준다.
export async function submitCbtAttempt(
  admin: SupabaseClient,
  userId: string,
  paperId: string,
  submitted: unknown[],
  opts: SubmitCbtAttemptOptions = {},
): Promise<CbtSubmitResult> {
  const now = opts.now ?? new Date();

  // 정답은 anon/authenticated에 전혀 노출하지 않으므로 service role로만 조회한다.
  const { data: paperAnswers } = await admin
    .from("paper_answers")
    .select("answers, voided_questions")
    .eq("paper_id", paperId)
    .maybeSingle();

  if (!paperAnswers) return { error: "이 문제지는 CBT를 지원하지 않아요.", status: 400 };

  const correctAnswers = ((paperAnswers as { answers: number[] | null }).answers ?? []) as number[];
  const voided = new Set(
    ((paperAnswers as { voided_questions: number[] | null }).voided_questions ?? []) as number[],
  );
  const totalQuestions = correctAnswers.length;
  if (totalQuestions === 0) return { error: "이 문제지는 CBT를 지원하지 않아요.", status: 400 };

  // 시작 행 회수. PostgREST 의 delete().select() 는 지운 행을 돌려준다(returning).
  const { data: claimed, error: claimError } = await admin
    .from("cbt_attempt_starts")
    .delete()
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .select("started_at");
  if (claimError) return { error: "채점에 실패했어요.", status: 500 };

  const startRecord = ((claimed ?? []) as { started_at: string }[])[0];
  if (!startRecord) {
    return { error: "새로고침 후 다시 시작해주세요.", status: 400 };
  }

  // 되돌리기 — 3)·4) 의 거절 경로에서 시작 행을 원래 시각 그대로 복구한다. upsert 인
  // 이유는 그 사이에 다른 기기가 새로 시작했을 수 있어서다(그 경우 나중 시작이 이기는
  // 규칙대로 덮지 않아야 하지만, 여기서는 동일 키라 upsert 가 덮는다 — 그래도 원래
  // 시각이 더 이르므로 "최소 응시시간" 판정에서 사용자에게 손해가 가지 않는다).
  const restoreStart = async () => {
    try {
      await admin
        .from("cbt_attempt_starts")
        .upsert(
          { user_id: userId, paper_id: paperId, started_at: startRecord.started_at },
          { onConflict: "user_id,paper_id" },
        );
    } catch {
      // 무시: 복구에 실패하면 사용자는 새로 시작해야 한다(다음 제출이 "새로고침" 안내).
    }
  };

  const elapsedSeconds =
    (now.getTime() - new Date(startRecord.started_at).getTime()) / 1000;
  if (elapsedSeconds < MIN_ATTEMPT_SECONDS) {
    await restoreStart();
    const waitSeconds = Math.ceil(MIN_ATTEMPT_SECONDS - elapsedSeconds);
    return {
      error: `최소 ${formatDuration(MIN_ATTEMPT_SECONDS)}은 풀어야 채점할 수 있어요. ${waitSeconds}초 후에 다시 시도해주세요.`,
      status: 400,
    };
  }

  // 저장용 duration도 클라이언트 값 대신 서버가 기록한 시작 시각 기준으로 계산한다.
  const durationSeconds = Math.round(elapsedSeconds);

  let score = 0;
  const questionResults: CbtQuestionResult[] = [];
  for (let i = 0; i < totalQuestions; i++) {
    const questionNumber = i + 1;
    const selected = sanitizeSelectedChoice(submitted[i]);
    const isCorrect = voided.has(questionNumber) || selected === correctAnswers[i];
    if (isCorrect) score++;
    questionResults.push({
      question_number: questionNumber,
      selected_choice: selected,
      is_correct: isCorrect,
    });
  }

  const { data: attempt, error: attemptError } = await admin
    .from("cbt_attempts")
    .insert({
      user_id: userId,
      paper_id: paperId,
      score,
      total_questions: totalQuestions,
      duration_seconds: durationSeconds,
    })
    .select("id")
    .single();

  if (attemptError || !attempt) {
    await restoreStart();
    return { error: "채점에 실패했어요.", status: 500 };
  }
  const attemptId = (attempt as { id: string }).id;

  const { error: answersError } = await admin.from("cbt_attempt_answers").insert(
    questionResults.map((q) => ({ attempt_id: attemptId, ...q })),
  );

  if (answersError) {
    // service_role이라 이 롤백이 실제로 지워진다 (사용자 세션에는 delete 정책이
    // 없어서 예전엔 이 줄이 조용히 아무것도 안 지우고 고아 응시 행을 남겼다).
    await admin.from("cbt_attempts").delete().eq("id", attemptId);
    await restoreStart();
    return { error: "채점에 실패했어요.", status: 500 };
  }

  // 문항 단위 통합 상태 갱신(오답노트 극복 판정·섞어풀기 공유). 부가 집계라 실패해도
  // 채점 결과는 그대로 돌려준다 — 마이그레이션 적용 전이면 테이블이 없어 조용히 무시된다.
  try {
    await recordQuestionResults(admin, userId, paperId, questionResults, "cbt", {
      now,
      ...opts.questionStatus,
    });
  } catch {
    // 무시: 상태 갱신 실패가 채점을 막지 않는다.
  }

  // 출석 도장(월간 카드 → 멤버십 일수). 접속이 아니라 푼 것이 출석이라, 채점된 문항이
  // 아니라 **답을 고른 문항**만 센다 — 빈 답안을 제출해도 문항 수만큼 도장이 찍히면
  // 최소 응시시간(90초)만 기다렸다 제출하는 스크립트가 멤버십 일수를 받아간다.
  // 부가 처리이고, 실패해도 채점을 되돌리지 않는다.
  try {
    await recordAttendance(
      admin,
      userId,
      attendanceQuestionCount({
        answeredCount: questionResults.filter((q) => q.selected_choice !== null).length,
        elapsedSeconds: durationSeconds,
      }),
      { now },
    );
  } catch {
    // 무시: 출석 기록 실패가 채점을 막지 않는다.
  }

  // 결과 모달에 "AI 약점 진단까지 응시 N/3"를 그리기 위한 누적치. 채점이 끝난 뒤라
  // 방금 응시도 포함된다. 진단 자격 판정(lib/ai-diagnosis getDiagnosisEligibility)과
  // 같은 두 집계다 — 부가 정보라 실패해도 채점 결과는 그대로 돌려준다.
  let diagnosisProgress: CbtSubmitSuccess["diagnosisProgress"];
  if (!opts.skipDiagnosisProgress) {
    try {
      const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
        admin
          .from("cbt_attempts")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId),
        admin
          .from("user_question_status")
          .select("paper_id", { count: "exact", head: true })
          .eq("user_id", userId)
          .gt("wrong_count", 0),
      ]);
      diagnosisProgress = { attemptCount: attemptCount ?? 0, wrongCount: wrongCount ?? 0 };
    } catch {
      // 무시: 진행 바 한 줄이 빠질 뿐이다.
    }
  }

  return {
    attemptId,
    score,
    totalQuestions,
    durationSeconds,
    voidedQuestions: [...voided],
    questionResults,
    diagnosisProgress,
  };
}
