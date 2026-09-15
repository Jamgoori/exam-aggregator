import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  recordQuestionResults as recordQuestionResultsRule,
  type QuestionResultSource,
} from "@gongmoa/core/server";

export type { QuestionResultInput } from "@gongmoa/core/server";
import type { QuestionResultInput } from "@gongmoa/core/server";

// 웹 어댑터. 규칙 본문(오답 횟수 증분·SRS 스케줄·leech·무료 기간 확인)은
// packages/core/src/rules/question-status.ts 하나에 있고, Edge Function(cbt-submit·
// review-submit)도 번들(_shared/core.mjs)로 같은 함수를 부른다. 여기는 service_role
// 클라이언트를 만들어 넘기는 일만 한다 — 호출부(서버 액션)가 세션에서 검증한 본인
// userId 만 넘겨야 한다는 전제는 그대로다.
//
// 부가 집계이므로 실패해도 채점 자체는 막지 않는다 — 호출부에서 try/catch로 삼킨다.
export async function recordQuestionResults(
  userId: string,
  paperId: string,
  results: QuestionResultInput[],
  // 'mix' = 기출 섞어풀기(내 오답이 아니라 과목 기출 전체에서 뽑아 푼 채점). 상태
  // 갱신 규칙은 review 와 같고, 이력(srs_reviews.source)에서만 구분된다.
  source: QuestionResultSource = "cbt",
): Promise<void> {
  if (results.length === 0) return;
  await recordQuestionResultsRule(createAdminClient(), userId, paperId, results, source);
}
