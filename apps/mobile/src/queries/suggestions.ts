import {
  isSuggestionsComments,
  isSuggestionsGet,
  isSuggestionsList,
  isSuggestionsWrite,
  type SuggestionsCommentsResponse,
  type SuggestionsGetResponse,
  type SuggestionsListResponse,
  type SuggestionsRequest,
  type SuggestionsWriteResponse,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { useAuth } from "../providers/auth-provider";

// 건의게시판 목록·상세·댓글·쓰기 — 웹 lib/suggestions.ts(읽기)와 suggestions/actions.ts(쓰기)의 앱 판
// (설계서 §6.2 건의 행, §6.7 #19).
//
// 게시판·공지와 달리 **읽기도 EF suggestions 를 거친다.** suggestions·suggestion_comments 는 anon/authenticated
// 의 SELECT 조차 회수돼 있어(남의 비밀글 자리를 "비밀글입니다" 로 보여주려면 서버가 행을 읽고 마스킹해야
// 한다) 앱 세션으로는 표를 읽을 길이 없다. 목록의 title/readable, 상세의 canEdit/canDelete/canAnswer, 댓글의
// canEdit/canDelete 가 전부 **부른 사람 기준**이라 응답이 뷰어에 종속된다 — 그래서 캐시 키는 공개
// ['catalog', …] 가 아니라 사용자별 ['me', userId, 'suggestions', …] 이고(비로그인은 'guest'), Edge 응답이라
// 디스크에도 남기지 않는다(§6.5 — meta.persist:false). 다른 계정으로 로그인한 화면에 이전 사용자의 "내 글"
// 판정·비밀글 제목이 남으면 안 된다.
//
// 조회수는 EF get 이 웹 countSuggestionView 규칙대로 센다(본인·관리자 제외) — 부를 때마다 세므로 상세는
// 웹의 "페이지 진입 1회" 와 맞춘다: 포그라운드 복귀 재조회를 끈다(refetchOnWindowFocus:false). 당겨서
// 새로고침은 웹의 새로고침처럼 다시 센다. 세 조회 모두 세션 판정(useAuth().loading)이 끝난 뒤에만 돈다 —
// 앱 시작 직후 'guest' 키로 먼저 부르면 본인 비밀글이 forbidden 으로 왔다가 로그인 키로 다시 오고, 조회수도
// 게스트 몫으로 한 번 더 센다.
//
// ── 캐시 키와 무효화 지도 ───────────────────────────────────────────────────
//   ['me', uid|'guest', 'suggestions', 'list', page]   목록 한 페이지(고정글 포함)   persist:false
//   ['me', uid|'guest', 'suggestions', 'post', id]     상세(세 갈래 status 그대로)   persist:false
//   ['me', uid|'guest', 'suggestions', 'comments', id] 댓글 평면 목록               persist:false
//
//   글 작성/수정/답변·댓글 작성/수정/삭제 → 접두 ['me', uid, 'suggestions'] 전체 무효화(웹 revalidatePath
//                                          "/suggestions" + "/suggestions/[id]" 자리)
//   글 삭제                              → post·comments(id) 제거 + 접두 무효화
//
// staleTime 은 게시판과 같다(목록·상세 60초, 댓글은 본인 RLS 데이터 등급 30초).

const SUGGESTION_STALE_MS = 60_000;

export type SuggestionListItem = SuggestionsListResponse["items"][number] & {
  // 차단 필터(core filterBlocked)용. EF 응답이 싣는 필드지만(rules/suggestions.ts SuggestionListItem) 아래
  // withAuthorId 가 한 번 더 확인한다 — 이 필드가 없던 Edge 가 배포돼 있으면 null 로 두어 탈퇴한 회원의
  // 글처럼 남긴다(없는 필드에 기대지 않는다, 앱 금지선).
  authorId: string | null;
};
export type SuggestionPage = Omit<SuggestionsListResponse, "items" | "pinnedItems"> & {
  items: SuggestionListItem[];
  pinnedItems: SuggestionListItem[];
};
export type SuggestionDetail = Extract<SuggestionsGetResponse, { status: "ok" }>["suggestion"];
export type SuggestionGetResult = SuggestionsGetResponse;
export type SuggestionCommentItem = SuggestionsCommentsResponse["items"][number] & {
  // 위 SuggestionListItem.authorId 와 같은 사정.
  authorId: string | null;
};

export const suggestionsRootKey = (userId: string | null) => ["me", userId ?? "guest", "suggestions"] as const;
export const suggestionListKey = (userId: string | null, page: number) =>
  [...suggestionsRootKey(userId), "list", page] as const;
export const suggestionKey = (userId: string | null, id: string) => [...suggestionsRootKey(userId), "post", id] as const;
export const suggestionCommentsKey = (userId: string | null, id: string) =>
  [...suggestionsRootKey(userId), "comments", id] as const;

function withAuthorId<T extends object>(item: T): T & { authorId: string | null } {
  const raw = (item as { authorId?: unknown }).authorId;
  return { ...item, authorId: typeof raw === "string" ? raw : null };
}

const UNEXPECTED = "요청에 실패했어요. 잠시 후 다시 시도해 주세요.";

// 목록 한 페이지(웹 fetchSuggestionPage). 고정 글(공지)은 서버가 1페이지에만 얹어 준다.
export function useSuggestionPage(page: number) {
  const { userId, loading } = useAuth();
  return useQuery<SuggestionPage>({
    queryKey: suggestionListKey(userId, page),
    queryFn: async () => {
      const res = await callEdge("suggestions", { action: "list", page });
      if (!isSuggestionsList(res)) throw new Error(UNEXPECTED);
      return { ...res, items: res.items.map(withAuthorId), pinnedItems: res.pinnedItems.map(withAuthorId) };
    },
    enabled: !loading,
    staleTime: SUGGESTION_STALE_MS,
    meta: { persist: false },
  });
}

// 상세(웹 fetchSuggestion 의 세 갈래 그대로 — ok / not_found / forbidden, 전부 HTTP 200). uuid 모양이 아닌 id 도
// 서버가 not_found 로 낸다(웹 `/suggestions/abc` 가 notFound() 인 것과 같다). 화면이 status 로 404·잠금 안내·
// 본문을 가른다.
export function useSuggestion(id: string | undefined) {
  const { userId, loading } = useAuth();
  return useQuery<SuggestionGetResult>({
    queryKey: suggestionKey(userId, id ?? ""),
    queryFn: async () => {
      const res = await callEdge("suggestions", { action: "get", id: id! });
      if (!isSuggestionsGet(res)) throw new Error(UNEXPECTED);
      return res;
    },
    enabled: !!id && !loading,
    staleTime: SUGGESTION_STALE_MS,
    refetchOnWindowFocus: false,
    meta: { persist: false },
  });
}

// 댓글 평면 목록(웹 fetchSuggestionComments — 답글 트리 없이 작성순 전부). 원글을 볼 수 있는지는 서버가 다시
// 본다(없으면 404, 비밀글이면 403 — 상세가 ok 일 때만 부르므로 정상 경로에서는 나오지 않는다).
export function useSuggestionComments(suggestionId: string | undefined, enabled = true) {
  const { userId, loading } = useAuth();
  return useQuery<SuggestionCommentItem[]>({
    queryKey: suggestionCommentsKey(userId, suggestionId ?? ""),
    queryFn: async () => {
      const res = await callEdge("suggestions", { action: "comments", id: suggestionId! });
      if (!isSuggestionsComments(res)) throw new Error(UNEXPECTED);
      return res.items.map(withAuthorId);
    },
    enabled: enabled && !!suggestionId && !loading,
    staleTime: STALE.me,
    meta: { persist: false },
  });
}

// ── 쓰기(EF suggestions) ─────────────────────────────────────────────────────
//
// 검증·비속어·시간당 한도(글 10·댓글 30)·알림·관리자 판정은 전부 규칙(core rules/suggestions.ts)에 있다 — 앱은
// 결과만 그린다. 오류는 EdgeError 그대로 던져 화면이 handleEdgeError 로 푼다(401 → 로그인 모달, 429 → amber …).

export type SuggestionWriteRequest = Exclude<SuggestionsRequest, { action: "list" | "get" | "comments" }>;

function useSuggestionMutation<Req extends SuggestionWriteRequest>(
  after?: (queryClient: ReturnType<typeof useQueryClient>, userId: string | null, req: Req) => void,
) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<SuggestionsWriteResponse, unknown, Req>({
    mutationFn: async (req) => {
      const res = await callEdge("suggestions", req);
      if (!isSuggestionsWrite(res)) throw new Error(UNEXPECTED);
      return res;
    },
    onSuccess: (_res, req) => {
      after?.(queryClient, userId, req);
      // 목록(제목·답변 완료 표시·건수)·상세(본문·답변)·댓글이 전부 이 사용자 키 아래라 접두 하나로 끝난다.
      void queryClient.invalidateQueries({ queryKey: suggestionsRootKey(userId) });
    },
  });
}

// 새 글(create). 응답 id 는 새 글의 id — 화면이 그리로 간다(웹 router.replace(`/suggestions/${id}`)).
export function useCreateSuggestion() {
  return useSuggestionMutation<Extract<SuggestionWriteRequest, { action: "create" }>>();
}

export function useUpdateSuggestion() {
  return useSuggestionMutation<Extract<SuggestionWriteRequest, { action: "update" }>>();
}

// 글 삭제. 지워진 글의 상세·댓글 캐시는 무효화가 아니라 제거한다 — 무효화하면 뒤로가기로 남은 화면이 다시
// 읽어 not_found 를 그리는 왕복이 생긴다.
export function useDeleteSuggestion() {
  return useSuggestionMutation<Extract<SuggestionWriteRequest, { action: "delete" }>>((queryClient, userId, req) => {
    queryClient.removeQueries({ queryKey: suggestionKey(userId, req.id) });
    queryClient.removeQueries({ queryKey: suggestionCommentsKey(userId, req.id) });
  });
}

// 운영자 답변(answer) — 관리자 전용(서버가 다시 판정한다).
export function useAnswerSuggestion() {
  return useSuggestionMutation<Extract<SuggestionWriteRequest, { action: "answer" }>>();
}

export type SuggestionCommentWriteRequest = Extract<
  SuggestionWriteRequest,
  { action: "comment.create" | "comment.update" | "comment.delete" }
>;

// 댓글 작성/수정/삭제(comment.*). 응답 id 는 원글 id(화면이 돌아갈 곳).
export function useSuggestionCommentWrite() {
  return useSuggestionMutation<SuggestionCommentWriteRequest>();
}
