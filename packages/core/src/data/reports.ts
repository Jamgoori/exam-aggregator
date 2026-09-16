import type { SupabaseClient } from "@supabase/supabase-js";

// 문항 오류 신고(DI) — RPC `submit_question_report`(설계서 §6.2 "문항 신고" 행, §6.7 #6).
//
// `question_reports` 는 insert 가 anon/authenticated 에서 회수돼 있다(schema.sql: 시간당 상한과
// 문항 번호 상한이 서버 액션 안에만 있어서, PostgREST 를 직접 부르면 한 번도 평가되지 않았다).
// 그래서 앱은 테이블이 아니라 이 RPC 하나만 부른다 — 검증(컨텍스트·사유 조합·메시지 500자·
// 시간당 20건·중복 신고)은 전부 함수 본문에 있고, 여기서는 인자를 넘기고 오류 문구를 그대로
// 올려 보낼 뿐이다(문구가 곧 화면 문구 — 웹 submitQuestionReport 와 같은 문장).
//
// 웹은 지금도 서버 액션(service_role)으로 넣는다. 두 경로의 판정이 갈리지 않도록 아래 상수·
// 라벨을 정본으로 두고, 웹 쪽을 이 파일로 모을 때는 apps/web/src/app/papers/actions.ts 의
// REPORT_REASONS·REPORT_MESSAGE_MAX·REPORT_HOURLY_LIMIT 을 여기로 옮긴다.

export const QUESTION_REPORT_CONTEXTS = ["explanation", "cbt"] as const;
export type QuestionReportContext = (typeof QUESTION_REPORT_CONTEXTS)[number];

export const QUESTION_REPORT_REASONS = [
  "wrong_answer",
  "wrong_explanation",
  "image_issue",
  "other",
] as const;
export type QuestionReportReason = (typeof QUESTION_REPORT_REASONS)[number];

// 화면에 그대로 쓰는 사유 문구(웹 report-question-button.tsx 의 REASONS 와 같은 문장).
export const QUESTION_REPORT_REASON_LABELS: Record<QuestionReportReason, string> = {
  wrong_answer: "정답이 잘못된 것 같아요",
  wrong_explanation: "해설에 오류가 있어요",
  image_issue: "이미지/문제 표시에 문제가 있어요",
  other: "기타",
};

// 메시지 상한(DB check `char_length(message) <= 500` 과 같은 값 — 서버가 left() 로 자른다).
export const QUESTION_REPORT_MESSAGE_MAX = 500;

// CBT 응시 중에는 아직 채점 전이라 정답도 해설도 보여주지 않는다 — "정답이 잘못됐다"/"해설에
// 오류가 있다"는 채점·해설 열람 뒤에야 판단할 수 있는 사유라 응시 화면에서는 감춘다. 서버(RPC)도
// 같은 조합을 거절하므로, 이 목록을 넓히면 화면에서만 뜨고 제출이 실패한다.
export function questionReportReasonsFor(
  context: QuestionReportContext,
): QuestionReportReason[] {
  return context === "cbt"
    ? QUESTION_REPORT_REASONS.filter(
        (r) => r !== "wrong_answer" && r !== "wrong_explanation",
      )
    : [...QUESTION_REPORT_REASONS];
}

export type SubmitQuestionReportInput = {
  paperId: string;
  questionNumber: number;
  context: QuestionReportContext;
  reason: QuestionReportReason;
  message?: string;
};

// plpgsql `raise exception` 의 SQLSTATE. 함수가 일부러 던진 오류만 이 코드로 오고, 그 message 는
// 곧 화면 문구다("이미 신고한 문항이에요. 확인 후 반영할게요." 등 — 웹 서버 액션과 같은 문장).
// 그 밖의 실패(함수 미적용 PGRST202·네트워크·권한)는 사용자에게 보여줄 말이 아니므로 웹과 같은
// 한 문장으로 덮는다.
const RAISE_EXCEPTION = "P0001";

// 접수되면 그냥 끝난다(반환값 없음). 실패는 전부 throw.
export async function submitQuestionReport(
  client: SupabaseClient,
  input: SubmitQuestionReportInput,
): Promise<void> {
  const { error } = await client.rpc("submit_question_report", {
    p_paper_id: input.paperId,
    p_question_number: input.questionNumber,
    p_context: input.context,
    p_reason: input.reason,
    p_message: input.message?.trim() ? input.message.trim() : null,
  });
  if (!error) return;
  throw new Error(
    error.code === RAISE_EXCEPTION && error.message
      ? error.message
      : "신고 접수에 실패했어요.",
  );
}
