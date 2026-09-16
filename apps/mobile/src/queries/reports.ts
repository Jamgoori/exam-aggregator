import { submitQuestionReport, type SubmitQuestionReportInput } from "@gongmoa/core";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "../lib/supabase";

// 문항 오류 신고 — RPC `submit_question_report`(설계서 §6.2 "문항 신고" 행, §6.7 #6).
//
// 검증(컨텍스트·사유 조합·메시지 500자·시간당 20건·중복 신고)은 전부 서버(RPC) 몫이고 앱은
// 결과 문구만 그린다 — `question_reports` 는 insert 가 회수돼 있어 테이블에 직접 넣는 경로가
// 없다(schema.sql). 실패 메시지는 서버가 준 한국어 문장을 그대로 쓴다(웹 서버 액션과 같은 문구).
//
// 무효화할 캐시가 없다(신고는 어떤 화면의 값도 바꾸지 않는다 — 관리자 대기열에만 쌓인다).
// 그래서 낙관적 업데이트도, 쿼리 키도 없다.
export function useSubmitQuestionReport() {
  return useMutation({
    mutationFn: (input: SubmitQuestionReportInput) => submitQuestionReport(supabase, input),
  });
}
