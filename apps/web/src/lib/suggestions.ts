import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { SUGGESTIONS_PAGE_SIZE, type SuggestionViewer } from "@gongmoa/core";
import {
  countSuggestionView as countSuggestionViewRule,
  fetchSuggestion as fetchSuggestionRule,
  fetchSuggestionComments as fetchSuggestionCommentsRule,
  fetchSuggestionPage as fetchSuggestionPageRule,
  type FetchSuggestionResult,
  type SuggestionCommentItem,
  type SuggestionDetail,
  type SuggestionListItem,
  type SuggestionPage,
} from "@gongmoa/core/server";

// 건의게시판 읽기 — **어댑터**다. 규칙(service_role 로 읽고 볼 권한이 없는 값을 내려보내기 전에 지우는
// 마스킹, 조회수 제외 규칙)은 전부 packages/core/src/rules/suggestions.ts 에 있고, Edge Function
// `suggestions` 가 같은 함수를 부른다(suggestions·suggestion_comments 는 SELECT 조차 회수돼 있어 앱도
// Edge 로 읽는다). 여기 남은 것은 세션 확보와 admin 클라이언트 주입뿐이다.

// 화면·컴포넌트가 계속 `@/lib/suggestions` 에서 가져가도록 core 값·타입을 그대로 다시 내보낸다.
export { SUGGESTIONS_PAGE_SIZE };
export type { FetchSuggestionResult, SuggestionCommentItem, SuggestionDetail, SuggestionListItem, SuggestionPage };

// suggestions 는 RLS 로 모든 클라이언트 읽기를 막아 뒀다(schema.sql 참고). 대신 규칙이 service_role 로
// 읽고, 볼 권한이 없는 값은 내려보내기 전에 지운다.
export async function getSuggestionViewer(): Promise<
  SuggestionViewer & { loggedIn: boolean }
> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { userId: null, isAdmin: false, loggedIn: false };

  const { data } = await supabase.rpc("is_admin");
  return { userId: user.id, isAdmin: data === true, loggedIn: true };
}

export async function fetchSuggestionPage(page: number, viewer: SuggestionViewer): Promise<SuggestionPage> {
  return fetchSuggestionPageRule(createAdminClient(), page, viewer);
}

export async function fetchSuggestion(
  id: string,
  viewer: SuggestionViewer,
): Promise<FetchSuggestionResult> {
  return fetchSuggestionRule(createAdminClient(), id, viewer);
}

// 조회수. 본인·관리자 제외 규칙은 core — authorId 가 null(탈퇴한 회원의 글)이면 비로그인도 센다.
export async function countSuggestionView(id: string, viewer: SuggestionViewer, authorId: string | null) {
  await countSuggestionViewRule(createAdminClient(), id, viewer, authorId);
}

// 댓글은 상세 화면이 fetchSuggestion 으로 원글 접근 권한(canReadSuggestion)을 이미 확인한 뒤에만
// 호출된다 — 규칙 쪽 주석 참고.
export async function fetchSuggestionComments(
  suggestionId: string,
  viewer: SuggestionViewer,
): Promise<SuggestionCommentItem[]> {
  return fetchSuggestionCommentsRule(createAdminClient(), suggestionId, viewer);
}
