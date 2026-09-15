import type { SupabaseClient } from "@supabase/supabase-js";
import type { CbtQuestionResult } from "../rules/cbt-attempt";

// CBT 응시 복원(DI) — 설계서 §6.6 "타임아웃 복구". 앱이 cbt-submit 응답을 못 받았거나
// "새로고침 후 다시 시작해주세요."(시작 행이 이미 회수됨 = 다른 요청이 먼저 채점)를 받으면
// 재제출하지 않고, 본인 응시(cbt_attempts + cbt_attempt_answers, 둘 다 RLS select own)에서
// 방금 채점된 행을 찾아 점수·문항 정오를 되살린다.
//
// 기준 창은 `created_at >= startedAt − 5분` — 다른 기기가 만든 응시의 created_at 이 이 기기의
// startedAt 보다 이를 수 있어 넓힌다. voidedQuestions 는 복원하지 않는다(paper_answers.
// voided_questions 는 admin 전용 RLS 라 읽을 수 없고, 결과 모달은 optional 로 취급).

export const RECOVER_ATTEMPT_WINDOW_MS = 5 * 60_000;

export type RecoveredAttempt = {
  attemptId: string;
  score: number;
  totalQuestions: number;
  durationSeconds: number;
  createdAt: string;
  questionResults: CbtQuestionResult[];
};

type AttemptRow = {
  id: string;
  score: number;
  total_questions: number;
  duration_seconds: number | null;
  created_at: string;
};

type AnswerRow = {
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

// 없으면 null(다른 기기에서 채점된 것도 아니고 아직 채점되지 않았다는 뜻 — 호출부는
// "다른 기기에서 이미 채점됐어요" 대신 재시작을 안내한다).
export async function recoverAttempt(
  client: SupabaseClient,
  userId: string,
  paperId: string,
  startedAt: string | Date,
): Promise<RecoveredAttempt | null> {
  const startedMs = typeof startedAt === "string" ? new Date(startedAt).getTime() : startedAt.getTime();
  if (!Number.isFinite(startedMs)) return null;
  const since = new Date(startedMs - RECOVER_ATTEMPT_WINDOW_MS).toISOString();

  const { data: attempts, error } = await client
    .from("cbt_attempts")
    .select("id, score, total_questions, duration_seconds, created_at")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`응시 복원 실패: ${error.message}`);

  const attempt = ((attempts ?? []) as AttemptRow[])[0];
  if (!attempt) return null;

  const { data: answers, error: answersError } = await client
    .from("cbt_attempt_answers")
    .select("question_number, selected_choice, is_correct")
    .eq("attempt_id", attempt.id)
    .order("question_number", { ascending: true });
  if (answersError) throw new Error(`응시 복원 실패: ${answersError.message}`);

  return {
    attemptId: attempt.id,
    score: attempt.score,
    totalQuestions: attempt.total_questions,
    durationSeconds: attempt.duration_seconds ?? 0,
    createdAt: attempt.created_at,
    questionResults: ((answers ?? []) as AnswerRow[]).map((a) => ({
      question_number: a.question_number,
      selected_choice: a.selected_choice,
      is_correct: a.is_correct,
    })),
  };
}
