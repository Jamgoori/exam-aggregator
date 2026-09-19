import {
  boardPreviewText,
  filterBlocked,
  isBoardCategory,
  validateReportInput,
  type BoardCategorySlug,
  type BoardWritePostResponse,
  type BoardWriteRequest,
  type ReportReasonSlug,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 자유게시판 조회·상세·댓글·좋아요·신고·차단 — 웹 lib/board.ts(조회)와 board/actions.ts(쓰기)의
// 앱 판(설계서 §6.2 게시판 행, §6.7 #17·#18).
//
// 읽기는 전부 공개 RLS(board_posts·board_comments "public read")라 앱 세션(anon 키)으로 그대로
// 읽는다. 웹은 아바타를 profiles 에서 함께 모아 오느라 admin 클라이언트를 쓰지만, 앱은 아바타를
// 별도 훅(queries/avatars.ts useAvatarUrls — RPC avatar_paths)으로 읽으므로 목록·댓글 항목에
// avatarUrl 이 없고 authorId 만 든다. 캐시 등급이 다르기도 하다: 글·댓글은 공개 콘텐츠라 퍼시스트
// 가능하고, 아바타·내 좋아요·차단 목록은 로그인 세션 전용이라 ['me', …] + persist:false 다.
//
// 쓰기는 두 갈래다. 글 삭제·댓글 작성/수정/삭제는 EF board-write(새니타이즈·검증·시간당 한도·알림이
// 전부 규칙 core rules/board.ts 에 있다 — 앱은 결과만 그린다). 좋아요·신고·차단은 SD RPC(§6.7 머리말
// 공통 규칙). board_posts·board_comments·board_post_likes 의 insert/update/delete 는 클라이언트에서
// 회수돼 있어 앱이 표에 직접 쓸 길은 없다(금지선).
//
// 글쓰기·수정·이미지 업로드 뮤테이션은 여기 없다 — queries/board-write.ts(B2). 그쪽은 성공 뒤
// 아래 키를 무효화한다: 새 글 → boardListRootKey, 수정 → boardListRootKey + boardPostKey(id).
//
// ── 캐시 키와 무효화 지도 ───────────────────────────────────────────────────
//   ['catalog','board','list', {page,category,q}]  목록 한 페이지(고정글 포함)      퍼시스트 O
//   ['catalog','board','post', id]                  글 상세(본문 HTML 포함)          퍼시스트 O
//   ['catalog','board','comments', id]              댓글 평면 목록                   퍼시스트 O
//   ['me', uid, 'board-like', id]                   내 좋아요 여부                   persist:false
//   ['me', uid, 'blocks']                           차단한 사용자 id 목록            persist:false
//
//   글 삭제(post.delete)   → list 접두 무효화, post·comments(id) 제거
//   댓글 작성/수정/삭제     → comments(id)·post(id)(comment_count)·list 접두(댓글 수) 무효화
//   좋아요 토글            → like(id)·post(id).likeCount 를 서버 응답 값으로 덮고 list 접두 무효화
//   차단/해제              → blocks 무효화(목록·상세·댓글은 blocks 를 읽어 클라이언트에서 거른다)
//
// staleTime 은 카탈로그(5분)보다 짧다: 글 목록·상세는 조회수·댓글 수·좋아요 수가 사람이 드나들
// 때마다 바뀌고 댓글은 그보다 더 자주 바뀐다. 목록·상세 60초, 댓글은 본인 RLS 데이터 등급(30초).

export const BOARD_PAGE_SIZE = 20;
const BOARD_STALE_MS = 60_000;

export type BoardListItem = {
  id: string;
  category: BoardCategorySlug;
  title: string;
  preview: string;
  nickname: string;
  authorId: string;
  createdAt: string;
  viewCount: number;
  commentCount: number;
  likeCount: number;
  thumbnailUrl: string | null;
  isPinned: boolean;
};

export type BoardPage = {
  items: BoardListItem[];
  pinnedItems: BoardListItem[];
  total: number;
  totalPages: number;
};

export type BoardPostDetail = {
  id: string;
  category: BoardCategorySlug;
  title: string;
  contentHtml: string;
  nickname: string;
  authorId: string;
  createdAt: string;
  updatedAt: string | null;
  viewCount: number;
  commentCount: number;
  likeCount: number;
  isPinned: boolean;
};

export type BoardCommentItem = {
  id: string;
  parentId: string | null;
  nickname: string;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  isDeleted: boolean;
};

// 화면이 그리는 트리 노드. 원 댓글 아래 답글들 — 1단계까지만(웹 BoardCommentItem.replies).
export type BoardCommentNode = BoardCommentItem & { replies: BoardCommentItem[] };

export type BoardListParams = { page: number; category?: string; q?: string };

export const boardListRootKey = ["catalog", "board", "list"] as const;
export const boardListKey = ({ page, category, q }: BoardListParams) =>
  [...boardListRootKey, { page, category: category ?? "", q: q ?? "" }] as const;
export const boardPostKey = (id: string) => ["catalog", "board", "post", id] as const;
export const boardCommentsKey = (id: string) => ["catalog", "board", "comments", id] as const;
export const boardLikeKey = (userId: string, id: string) => ["me", userId, "board-like", id] as const;
export const blocksKey = (userId: string) => ["me", userId, "blocks"] as const;

const LIST_COLUMNS =
  "id, user_id, nickname, category, title, content_text, thumbnail_url, view_count, comment_count, like_count, is_pinned, created_at";

type Row = Record<string, unknown>;

function toListItem(row: Row): BoardListItem {
  return {
    id: row.id as string,
    category: (isBoardCategory(row.category) ? row.category : "free") as BoardCategorySlug,
    title: row.title as string,
    preview: boardPreviewText((row.content_text as string) ?? ""),
    nickname: row.nickname as string,
    authorId: row.user_id as string,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    commentCount: row.comment_count as number,
    likeCount: row.like_count as number,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    isPinned: row.is_pinned as boolean,
  };
}

// 목록 한 페이지(웹 fetchBoardPage 1:1). 고정 글(공지)은 1페이지 맨 위에만 따로 얹는다(건의게시판과
// 같은 규칙 — 매 페이지 반복하면 "몇 페이지에 있었더라"가 헷갈린다).
async function fetchBoardPage({ page, category, q }: BoardListParams): Promise<BoardPage> {
  const from = (page - 1) * BOARD_PAGE_SIZE;
  const activeCategory = isBoardCategory(category) ? category : null;
  const keyword = (q ?? "").trim();

  let listQuery = supabase.from("board_posts").select(LIST_COLUMNS, { count: "exact" }).eq("is_pinned", false);

  if (activeCategory) listQuery = listQuery.eq("category", activeCategory);
  if (keyword) {
    // 제목과 평문 본문 양쪽에서 찾는다. content_text 가 있는 이유가 이것이다 — HTML 을 그대로 like
    // 검색하면 태그 이름("span")이 검색어에 걸린다.
    // PostgREST or() 필터 문법의 구분자(, 괄호)·따옴표·역슬래시·like 와일드카드(%)는 미리 털어낸다 —
    // 남겨두면 검색어로 필터식을 조립하는 셈이 된다(공개 표라 새는 것은 없지만, 깨진 필터는 오류 →
    // 빈 결과로 나간다). 이 치환식은 웹 apps/web/src/lib/board.ts#fetchBoardPage 와 **같은 규칙**을
    // 옮겨 적은 것이다 — 그쪽이 서버 전용(server-only) 모듈이라 함수를 가져올 수 없어 두 곳이 됐다.
    // 한쪽을 바꾸면 웹과 앱의 검색 결과가 갈리므로 같이 고친다.
    const safe = keyword.replace(/[%,()"'\\]/g, " ").trim();
    if (safe) listQuery = listQuery.or(`title.ilike.%${safe}%,content_text.ilike.%${safe}%`);
  }

  const [listResult, pinnedResult] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(from, from + BOARD_PAGE_SIZE - 1),
    // 고정 글은 1페이지에서, 검색·말머리 필터가 없을 때만 얹는다(필터를 건 목록에 상관없는 공지가
    // 끼면 결과가 오염된다).
    page === 1 && !keyword && !activeCategory
      ? supabase.from("board_posts").select(LIST_COLUMNS).eq("is_pinned", true).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[], error: null }),
  ]);
  if (listResult.error) throw new Error(`게시글 목록 조회 실패: ${listResult.error.message}`);
  if (pinnedResult.error) throw new Error(`게시글 목록 조회 실패: ${pinnedResult.error.message}`);

  const total = listResult.count ?? 0;
  return {
    items: ((listResult.data ?? []) as Row[]).map(toListItem),
    pinnedItems: ((pinnedResult.data ?? []) as Row[]).map(toListItem),
    total,
    totalPages: Math.max(1, Math.ceil(total / BOARD_PAGE_SIZE)),
  };
}

export function useBoardPage(params: BoardListParams) {
  return useQuery<BoardPage>({
    queryKey: boardListKey(params),
    queryFn: () => fetchBoardPage(params),
    staleTime: BOARD_STALE_MS,
  });
}

// uuid 가 아닌 값으로 uuid 컬럼을 거르면 PostgREST 가 이 코드(invalid_text_representation)로 거절한다.
// 웹은 그 오류를 삼키고 notFound() 를 내므로(`lib/board.ts` fetchBoardPost 가 error 를 보지 않는다) 앱도
// "없는 글"로 본다 — `/board/abc` 같은 딥링크가 재시도 버튼 달린 오류가 아니라 404 화면이 되게.
export const INVALID_UUID_CODE = "22P02";

// 글 상세(웹 fetchBoardPost). 없는 글은 null — 화면이 404(+not-found)로 그린다. canEdit/canDelete 는
// 보는 사람에 따라 달라 공개 캐시에 넣지 않고 화면이 core canEditBoardPost/canDeleteBoardPost 로 센다.
async function fetchBoardPost(id: string): Promise<BoardPostDetail | null> {
  const { data, error } = await supabase
    .from("board_posts")
    .select(
      "id, user_id, nickname, category, title, content_html, view_count, comment_count, like_count, is_pinned, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (error.code === INVALID_UUID_CODE) return null;
    throw new Error(`게시글 조회 실패: ${error.message}`);
  }
  if (!data) return null;
  const row = data as Row;
  return {
    id: row.id as string,
    category: (isBoardCategory(row.category) ? row.category : "free") as BoardCategorySlug,
    title: row.title as string,
    contentHtml: row.content_html as string,
    nickname: row.nickname as string,
    authorId: row.user_id as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
    viewCount: row.view_count as number,
    commentCount: row.comment_count as number,
    likeCount: row.like_count as number,
    isPinned: row.is_pinned as boolean,
  };
}

export function useBoardPost(id: string | undefined) {
  return useQuery<BoardPostDetail | null>({
    queryKey: boardPostKey(id ?? ""),
    queryFn: () => fetchBoardPost(id!),
    enabled: !!id,
    staleTime: BOARD_STALE_MS,
  });
}

// 조회수(웹 countBoardView). 글쓴이 본인이 열어본 것은 세지 않는다(건의게시판과 같은 이유 — 자기 글을
// 몇 번 열었는지가 "몇 명이 봤나"에 섞이면 숫자의 뜻이 사라진다). RPC 는 anon 도 실행할 수 있어
// 게스트의 열람도 웹처럼 센다. 실패는 삼킨다 — 조회수 하나 때문에 화면을 막을 이유가 없다.
export async function countBoardView(postId: string, viewerId: string | null, authorId: string): Promise<void> {
  if (viewerId === authorId) return;
  await supabase.rpc("increment_board_view", { p_post_id: postId }).then(() => {}, () => {});
}

// 댓글 평면 목록(웹 fetchBoardComments 의 조회 부분). 트리는 buildBoardCommentTree 가 화면에서 만든다 —
// 차단 필터(내 상태)를 공개 캐시에 섞지 않기 위해 조회와 배치를 나눈다.
async function fetchBoardComments(postId: string): Promise<BoardCommentItem[]> {
  const { data, error } = await supabase
    .from("board_comments")
    .select("id, parent_id, user_id, nickname, content, is_deleted, created_at, updated_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`댓글 조회 실패: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => {
    const isDeleted = row.is_deleted as boolean;
    return {
      id: row.id as string,
      parentId: (row.parent_id as string | null) ?? null,
      nickname: row.nickname as string,
      authorId: row.user_id as string,
      // 지워진 댓글은 본문을 들고 있지 않는다(웹은 서버에서 비운다 — 앱은 캐시에 남지 않게 여기서).
      content: isDeleted ? "" : (row.content as string),
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string | null) ?? null,
      isDeleted,
    };
  });
}

export function useBoardComments(postId: string | undefined) {
  return useQuery<BoardCommentItem[]>({
    queryKey: boardCommentsKey(postId ?? ""),
    queryFn: () => fetchBoardComments(postId!),
    enabled: !!postId,
    staleTime: STALE.me,
  });
}

// 웹 fetchBoardComments 의 배치 규칙 그대로: parent_id 로 1단계 트리. 부모가 사라진 답글(경합으로
// 부모만 하드 삭제된 경우)은 원 댓글처럼 보여준다 — 매달 자리가 없다고 통째로 감추면 쓴 사람만
// 억울하다. 답글만 남고 원 댓글이 지워진 자리는 "삭제된 댓글입니다"로 남아 있어야 맥락이 유지되므로
// (is_deleted) 여기서 걸러내지 않는다. 차단한 사용자의 댓글은 원 댓글·답글 어느 자리든 뺀다(core
// filterBlocked) — 원 댓글이 차단돼 빠지면 그 아래 답글은 부모 없는 답글이 되어 원 댓글 자리로 올라온다.
export function buildBoardCommentTree(
  items: readonly BoardCommentItem[],
  blockedIds: ReadonlySet<string>,
): BoardCommentNode[] {
  const visible = filterBlocked(items, blockedIds);
  const nodes: BoardCommentNode[] = visible.map((item) => ({ ...item, replies: [] }));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const roots: BoardCommentNode[] = [];
  for (const node of nodes) {
    const parent = node.parentId ? byId.get(node.parentId) : undefined;
    if (parent) parent.replies.push(node);
    else roots.push(node);
  }
  return roots;
}

// ── 내 좋아요 ─────────────────────────────────────────────────────────────────

// 내가 이 글에 좋아요를 눌렀는지(웹 hasLikedBoardPost). board_post_likes 의 "select own" RLS 로 내 행만
// 읽는다. 비로그인은 enabled:false → 화면은 false 로 그린다.
export function useMyBoardLike(postId: string | undefined) {
  const { userId } = useAuth();
  return useQuery<boolean>({
    queryKey: boardLikeKey(userId ?? "", postId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("board_post_likes")
        .select("post_id")
        .eq("post_id", postId!)
        .eq("user_id", userId!)
        .maybeSingle();
      if (error) throw new Error(`좋아요 조회 실패: ${error.message}`);
      return Boolean(data);
    },
    enabled: !!userId && !!postId,
    staleTime: STALE.me,
    meta: { persist: false },
  });
}

// plpgsql `raise exception` 의 SQLSTATE. 함수가 일부러 던진 오류만 이 코드로 오고 그 message 가 곧 화면
// 문구다(queries/notifications.ts·core data/reports.ts 와 같은 규칙). 그 밖의 실패(함수 미적용 PGRST202·
// 네트워크)는 사용자에게 보여줄 말이 아니라 호출부가 준 한 문장으로 덮는다.
const RAISE_EXCEPTION = "P0001";

function rpcErrorMessage(error: { code?: string; message?: string }, fallback: string): string {
  return error.code === RAISE_EXCEPTION && error.message ? error.message : fallback;
}

type ToggleLikeRow = { liked: boolean; like_count: number };

function patchPostLikeCount(queryClient: QueryClient, postId: string, map: (n: number) => number): void {
  queryClient.setQueryData<BoardPostDetail | null>(boardPostKey(postId), (prev) =>
    prev ? { ...prev, likeCount: map(prev.likeCount) } : prev,
  );
}

// 좋아요 토글(RPC toggle_board_like, 웹 toggleBoardLike 어댑터와 같은 함수). 누른 즉시 숫자가 바뀌고
// (낙관적 반영) 서버가 거절하면 되돌린다 — 왕복을 기다리게 하면 "눌렸나?" 하고 두 번 누른다(웹
// BoardLikeButton). 성공하면 서버가 다시 센 like_count 로 덮는다(다른 사람이 동시에 눌렀을 때 ±1 이
// 어긋나지 않게 — RPC 가 그 값을 돌려주는 이유). 실패 문구는 웹 "잠시 후 다시 시도해주세요." 그대로.
export function useToggleBoardLike(postId: string) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<ToggleLikeRow, Error, void, { liked: boolean | undefined }>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("toggle_board_like", { p_post_id: postId });
      if (error) throw new Error(rpcErrorMessage(error, "잠시 후 다시 시도해주세요."));
      const row = (Array.isArray(data) ? data[0] : data) as ToggleLikeRow | undefined;
      if (!row) throw new Error("잠시 후 다시 시도해주세요.");
      return row;
    },
    onMutate: () => {
      const likeKey = boardLikeKey(userId ?? "", postId);
      const liked = queryClient.getQueryData<boolean>(likeKey);
      const next = !liked;
      queryClient.setQueryData<boolean>(likeKey, next);
      patchPostLikeCount(queryClient, postId, (n) => Math.max(0, n + (next ? 1 : -1)));
      return { liked };
    },
    onError: (_e, _v, ctx) => {
      const rolledBack = ctx?.liked ?? false;
      queryClient.setQueryData<boolean>(boardLikeKey(userId ?? "", postId), rolledBack);
      patchPostLikeCount(queryClient, postId, (n) => Math.max(0, n + (rolledBack ? 1 : -1)));
    },
    onSuccess: (row) => {
      queryClient.setQueryData<boolean>(boardLikeKey(userId ?? "", postId), row.liked);
      patchPostLikeCount(queryClient, postId, () => row.like_count);
      // 목록 줄의 하트 숫자도 이 글의 것이 바뀌었다(웹 router.refresh() 자리).
      void queryClient.invalidateQueries({ queryKey: boardListRootKey });
    },
  });
}

// ── EF board-write (삭제·댓글) ─────────────────────────────────────────────

// 글 삭제(post.delete). 글쓰기·수정·이미지는 queries/board-write.ts(B2) — 이 뮤테이션 하나만 여기 두는
// 이유는 상세 화면(B1)의 버튼이 부르기 때문이다. 오류는 EdgeError 그대로 던져 화면이 handleEdgeError 로
// 푼다(401 → 로그인 모달, 429 → amber …).
export function useDeleteBoardPost() {
  const queryClient = useQueryClient();
  return useMutation<BoardWritePostResponse, unknown, string>({
    mutationFn: (id) => callEdge("board-write", { action: "post.delete", id }) as Promise<BoardWritePostResponse>,
    onSuccess: (_res, id) => {
      queryClient.removeQueries({ queryKey: boardPostKey(id) });
      queryClient.removeQueries({ queryKey: boardCommentsKey(id) });
      void queryClient.invalidateQueries({ queryKey: boardListRootKey });
    },
  });
}

export type BoardCommentWriteRequest = Extract<
  BoardWriteRequest,
  { action: "comment.create" | "comment.update" | "comment.delete" }
>;

// 댓글 작성/수정/삭제(comment.*). 답글은 parentId 에 대상 댓글 id — 답글의 답글은 서버가 원 댓글로 접어
// 올린다(core resolveBoardCommentParent). 성공 뒤 댓글 목록·글(comment_count)·목록 줄을 다시 읽는다.
export function useBoardCommentWrite(postId: string) {
  const queryClient = useQueryClient();
  return useMutation<BoardWritePostResponse, unknown, BoardCommentWriteRequest>({
    mutationFn: (req) => callEdge("board-write", req) as Promise<BoardWritePostResponse>,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: boardCommentsKey(postId) });
      void queryClient.invalidateQueries({ queryKey: boardPostKey(postId) });
      void queryClient.invalidateQueries({ queryKey: boardListRootKey });
    },
  });
}

// ── 신고·차단 (웹에 없음 — Apple 1.2 UGC 요건, 설계서 §6.7 #18·§12-2 #16) ─────

// 차단한 사용자 id 목록. user_blocks 의 "select own" RLS 로 내 행만 온다. 비로그인은 빈 목록.
// 목록·상세·댓글이 이 집합으로 클라이언트에서 거른다(서버 RLS 는 건드리지 않음 — 앱 전용 필터).
export function useBlockedIds(): { ids: ReadonlySet<string>; isPending: boolean } {
  const { userId } = useAuth();
  const query = useQuery<string[]>({
    queryKey: blocksKey(userId ?? ""),
    queryFn: async () => {
      const { data, error } = await supabase.from("user_blocks").select("blocked_id");
      if (error) throw new Error(`차단 목록 조회 실패: ${error.message}`);
      return ((data ?? []) as { blocked_id: string }[]).map((row) => row.blocked_id);
    },
    enabled: !!userId,
    staleTime: STALE.me,
    meta: { persist: false },
  });
  const ids = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { ids, isPending: !!userId && query.isPending };
}

// 차단한 사용자 목록(닉네임 포함) — 내 정보 수정의 "차단한 사용자" 절이 그린다. id 집합(useBlockedIds)과
// 달리 화면 하나만 쓰므로 필요할 때만 읽는다. 키는 blocksKey 아래에 두어 차단/해제의 invalidate(접두 일치)가
// 이 목록도 함께 버리게 한다. 닉네임은 SD RPC my_blocked_users 가 profiles 에서 붙인다(user_blocks 에는 id 만
// 있고 profiles 는 본인 행만 보이는 RLS 라 앱이 직접 join 할 수 없다).
export type BlockedUser = { userId: string; nickname: string; createdAt: string };

export function useBlockedUsers() {
  const { userId } = useAuth();
  return useQuery<BlockedUser[]>({
    queryKey: [...blocksKey(userId ?? ""), "users"] as const,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("my_blocked_users");
      if (error) throw new Error(rpcErrorMessage(error, "차단 목록을 불러오지 못했어요."));
      return ((data ?? []) as { user_id: string; nickname: string; created_at: string }[]).map((row) => ({
        userId: row.user_id,
        nickname: row.nickname,
        createdAt: row.created_at,
      }));
    },
    enabled: !!userId,
    staleTime: STALE.me,
    meta: { persist: false },
  });
}

export type ReportPostInput = { postId: string; reason: ReportReasonSlug | ""; detail: string };

// 게시글 신고(RPC report_post). 폼 검증은 core validateReportInput — RPC 본문이 같은 검사를 되풀이한다.
// 오류 문구는 RPC 가 준 문장 그대로("이미 신고한 글이에요." 등), 그 외는 한 문장으로 덮는다.
export function useReportPost() {
  return useMutation<void, Error, ReportPostInput>({
    mutationFn: async ({ postId, reason, detail }) => {
      const validated = validateReportInput({ reason, detail });
      if ("error" in validated) throw new Error(validated.error);
      const { error } = await supabase.rpc("report_post", {
        p_post_id: postId,
        p_reason: validated.reason,
        p_detail: validated.detail,
      });
      if (error) throw new Error(rpcErrorMessage(error, "신고에 실패했어요. 잠시 후 다시 시도해주세요."));
    },
  });
}

// 사용자 차단(RPC block_user, 멱등). 끝나면 blocks 를 다시 읽는다 — 목록·상세·댓글이 그 집합을 보고
// 있어 그 사용자의 글·댓글이 즉시 사라진다.
export function useBlockUser() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (blockedId) => {
      const { error } = await supabase.rpc("block_user", { p_user_id: blockedId });
      if (error) throw new Error(rpcErrorMessage(error, "차단에 실패했어요. 잠시 후 다시 시도해주세요."));
    },
    onSuccess: (_res, blockedId) => {
      if (!userId) return;
      queryClient.setQueryData<string[]>(blocksKey(userId), (prev) =>
        prev && !prev.includes(blockedId) ? [...prev, blockedId] : (prev ?? [blockedId]),
      );
      void queryClient.invalidateQueries({ queryKey: blocksKey(userId) });
    },
  });
}

// 차단 해제(RPC unblock_user, 멱등). 내 정보 수정의 "차단한 사용자" 절이 부른다.
export function useUnblockUser() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: async (blockedId) => {
      const { error } = await supabase.rpc("unblock_user", { p_user_id: blockedId });
      if (error) throw new Error(rpcErrorMessage(error, "차단 해제에 실패했어요. 잠시 후 다시 시도해주세요."));
    },
    onSuccess: (_res, blockedId) => {
      if (!userId) return;
      queryClient.setQueryData<string[]>(blocksKey(userId), (prev) => prev?.filter((id) => id !== blockedId));
      void queryClient.invalidateQueries({ queryKey: blocksKey(userId) });
    },
  });
}

// 공유 주소 — **항상 웹 정본 URL**(설계서 §6.7 #32). 앱 스킴(gongmoa://)이나 EXPO_PUBLIC_WEB_URL 로
// 조립하지 않는다: 받는 사람에게 앱이 없을 수도 있고, 유니버설 링크가 서면 이 주소가 그대로 앱으로 열린다.
export function boardShareUrl(postId: string): string {
  return `https://gongmoa.kr/board/${postId}`;
}
