import { validateReportInput, type ReportReasonSlug, type ReportTargetType } from "@gongmoa/core";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";
import { rpcErrorMessage } from "./board";

// 콘텐츠 신고 — 게시글·건의글·채팅 메시지가 같은 RPC report_content(p_target_type, p_target_id, p_reason,
// p_detail) 하나를 부른다(Phase 5 2라운드, 설계서 §12-2 #16). 1라운드의 report_post(게시글 전용)는 본문이
// report_content('board_post', …) 로 바뀌어 그대로 살아 있지만, 앱은 대상 종류를 인자로 받는 이 훅 하나로
// 통일한다 — 신고 시트(components/board/board-report-sheet.tsx)가 게시글·건의글을 같은 화면으로 그리기
// 때문이다. 대상 종류 목록은 core REPORT_TARGET_TYPES(DB check 와 같은 값).
//
// 폼 검증은 core validateReportInput — RPC 본문이 같은 검사를 되풀이한다. 오류 문구는 RPC 가 준 문장
// 그대로("이미 신고한 글이에요." · 볼 수 없는 비밀 건의글은 "글을 찾을 수 없어요." 등), 그 외는 한 문장으로
// 덮는다(queries/board.ts useReportPost 와 같은 규칙).
export type ReportContentInput = {
  target: ReportTargetType;
  targetId: string;
  reason: ReportReasonSlug | "";
  detail: string;
};

export function useReportContent() {
  return useMutation<void, Error, ReportContentInput>({
    mutationFn: async ({ target, targetId, reason, detail }) => {
      const validated = validateReportInput({ reason, detail });
      if ("error" in validated) throw new Error(validated.error);
      const { error } = await supabase.rpc("report_content", {
        p_target_type: target,
        p_target_id: targetId,
        p_reason: validated.reason,
        p_detail: validated.detail,
      });
      if (error) throw new Error(rpcErrorMessage(error, "신고에 실패했어요. 잠시 후 다시 시도해주세요."));
    },
  });
}
