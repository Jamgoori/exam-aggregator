import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveExplanationAccess as resolveExplanationAccessRule,
  type ExplanationAccessAction,
} from "@gongmoa/core/server";

// 해설 열람 접근 규칙의 웹 어댑터. 두 제한(시간당 한도 / 무료 회원 일일 한도)의 본문과
// 상수는 packages/core/src/rules/explanation-access.ts 에 있고, Edge explanations-get 도
// 번들로 같은 함수를 부른다. 여기는 service_role 클라이언트를 넘기는 일만 한다.
export {
  ANON_PREVIEW_CARDS,
  EXPLANATION_DOWNLOAD_HOURLY_LIMIT,
  EXPLANATION_VIEW_HOURLY_LIMIT,
  type ExplanationAccess,
  type ExplanationAccessAction,
} from "@gongmoa/core/server";

// 해설 페이지가 부르는 단일 진입점. premium 은 호출부에서 판정해 넘긴다(관리자 포함).
export async function resolveExplanationAccess(input: {
  userId: string;
  paperId: string;
  action: ExplanationAccessAction;
  premium: boolean;
}) {
  return resolveExplanationAccessRule(createAdminClient(), input);
}
