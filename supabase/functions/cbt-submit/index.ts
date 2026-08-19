// 웹 submitCbtAttempt 포팅. 정답 조회·채점·응시 기록 쓰기를 전부 service_role 로
// 한다. 최소 응시시간 검증은 서버가 기록한 시작 시각 기준. 클라이언트가 보내는
// duration 은 신뢰하지 않는다.
import {
  corsHeaders,
  formatDuration,
  isUuid,
  json,
  MIN_ATTEMPT_SECONDS,
  sanitizeSelectedChoice,
} from "../_shared/cbt.ts";
import { adminClient, requireUser } from "../_shared/clients.ts";
import { recordQuestionResults } from "../_shared/status.ts";
import { attendanceQuestionCount, recordAttendance } from "../_shared/attendance.ts";

type QuestionResult = {
  question_number: number;
  selected_choice: number | null;
  is_correct: boolean;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;
  const userId = auth.userId;

  let paperId = "";
  let submitted: (number | null)[] = [];
  try {
    const body = await req.json();
    paperId = String(body?.paperId ?? "");
    submitted = Array.isArray(body?.answers) ? body.answers : [];
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }
  if (!isUuid(paperId)) return json({ error: "잘못된 접근입니다." }, 400);

  const admin = adminClient();

  const { data: paperAnswers } = await admin
    .from("paper_answers")
    .select("answers, voided_questions")
    .eq("paper_id", paperId)
    .maybeSingle();

  if (!paperAnswers) return json({ error: "이 문제지는 CBT를 지원하지 않아요." }, 400);

  const correctAnswers = (paperAnswers.answers ?? []) as number[];
  const voided = new Set((paperAnswers.voided_questions ?? []) as number[]);
  const totalQuestions = correctAnswers.length;
  if (totalQuestions === 0) {
    return json({ error: "이 문제지는 CBT를 지원하지 않아요." }, 400);
  }

  const { data: startRecord } = await admin
    .from("cbt_attempt_starts")
    .select("started_at")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (!startRecord) return json({ error: "새로고침 후 다시 시작해주세요." }, 400);

  const elapsedSeconds =
    (Date.now() - new Date(startRecord.started_at).getTime()) / 1000;
  if (elapsedSeconds < MIN_ATTEMPT_SECONDS) {
    const waitSeconds = Math.ceil(MIN_ATTEMPT_SECONDS - elapsedSeconds);
    return json(
      {
        error: `최소 ${formatDuration(MIN_ATTEMPT_SECONDS)}은 풀어야 채점할 수 있어요. ${waitSeconds}초 후에 다시 시도해주세요.`,
      },
      400,
    );
  }

  const durationSeconds = Math.round(elapsedSeconds);

  let score = 0;
  const questionResults: QuestionResult[] = [];
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

  if (attemptError || !attempt) return json({ error: "채점에 실패했어요." }, 500);

  const { error: answersError } = await admin
    .from("cbt_attempt_answers")
    .insert(questionResults.map((q) => ({ attempt_id: attempt.id, ...q })));

  if (answersError) {
    await admin.from("cbt_attempts").delete().eq("id", attempt.id);
    return json({ error: "채점에 실패했어요." }, 500);
  }

  // 문항 단위 통합 상태 갱신(오답노트 극복 판정 등). 부가 집계라 실패해도 채점은 유지.
  try {
    await recordQuestionResults(admin, userId, paperId, questionResults, "cbt");
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
    );
  } catch {
    // 무시: 출석 기록 실패가 채점을 막지 않는다.
  }

  // 같은 시작 시각으로 재제출(replay)해 회독을 늘리는 걸 막기 위해 시작 기록 삭제.
  await admin
    .from("cbt_attempt_starts")
    .delete()
    .eq("user_id", userId)
    .eq("paper_id", paperId);

  return json({
    success: true,
    attemptId: attempt.id,
    score,
    totalQuestions,
    durationSeconds,
    voidedQuestions: [...voided],
    questionResults,
  });
});

// 문항 단위 상태·SRS 갱신은 _shared/status.ts 하나로 모았다. 예전엔 여기에 같은
// 함수가 한 벌 더 있었는데, 섞어풀기(review-submit)만 _shared 를 쓰는 바람에 한쪽만
// 고치면 CBT 채점이 조용히 옛 규칙으로 남는 구조였다.
