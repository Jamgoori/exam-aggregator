import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { getSessionUser } from "@/lib/supabase/session";
import { fetchAvatarUrls } from "@/lib/avatars";
import {
  boardImageOrigin as coreBoardImageOrigin,
  boardPreviewText,
  canDeleteBoardComment,
  canDeleteBoardPost,
  canEditBoardComment,
  canEditBoardPost,
  isBoardCategory,
  type BoardCategorySlug,
  type BoardViewer,
} from "@gongmoa/core";

// 자유게시판 조회. 규칙(권한·검증)은 packages/core/src/board.ts 에 있다.
//
// 읽기는 완전히 공개(RLS: public read)라 service_role 이 꼭 필요하지는 않지만,
// 목록에 붙는 아바타를 profiles 에서 모아 읽어야 해서(본인 행만 select 가능한 RLS)
// 여기서는 admin 클라이언트로 통일한다. 내려보내는 값은 모두 게시판에 공개로
// 붙는 것들이다.

export const BOARD_PAGE_SIZE = 20;

// 본문에 삽입한 이미지의 공개 URL 접두사. 새니타이저가 이 접두사로 시작하는
// 이미지만 남긴다(임의의 외부 주소를 본문에 남기면 추적 픽셀 자리가 된다).
// 조립 규칙은 core board-image.ts 한 곳 — Edge board-write 가 SUPABASE_URL 로 같은 문자열을 만든다.
export function boardImageOrigin(): string {
  return coreBoardImageOrigin(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
}

export type BoardListItem = {
  id: string;
  category: BoardCategorySlug;
  title: string;
  preview: string;
  nickname: string;
  avatarUrl: string | null;
  createdAt: string;
  viewCount: number;
  commentCount: number;
  likeCount: number;
  thumbnailUrl: string | null;
  isPinned: boolean;
};

export type BoardPostDetail = {
  id: string;
  category: BoardCategorySlug;
  title: string;
  contentHtml: string;
  nickname: string;
  avatarUrl: string | null;
  authorId: string;
  createdAt: string;
  updatedAt: string | null;
  viewCount: number;
  commentCount: number;
  likeCount: number;
  isPinned: boolean;
  canEdit: boolean;
  canDelete: boolean;
};

export type BoardCommentItem = {
  id: string;
  parentId: string | null;
  nickname: string;
  avatarUrl: string | null;
  authorId: string;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  isDeleted: boolean;
  canEdit: boolean;
  canDelete: boolean;
  // 원 댓글 아래 붙는 답글들. 1단계까지만 내려간다.
  replies: BoardCommentItem[];
};

export async function getBoardViewer(): Promise<BoardViewer & { loggedIn: boolean }> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { userId: null, isAdmin: false, loggedIn: false };

  const { data } = await supabase.rpc("is_admin");
  return { userId: user.id, isAdmin: data === true, loggedIn: true };
}

const LIST_COLUMNS =
  "id, user_id, nickname, category, title, content_text, thumbnail_url, view_count, comment_count, like_count, is_pinned, created_at";

type ListRow = Record<string, unknown>;

function toListItem(row: ListRow, avatars: Map<string, string>): BoardListItem {
  return {
    id: row.id as string,
    category: (isBoardCategory(row.category) ? row.category : "free") as BoardCategorySlug,
    title: row.title as string,
    preview: boardPreviewText((row.content_text as string) ?? ""),
    nickname: row.nickname as string,
    avatarUrl: avatars.get(row.user_id as string) ?? null,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    commentCount: row.comment_count as number,
    likeCount: row.like_count as number,
    thumbnailUrl: (row.thumbnail_url as string | null) ?? null,
    isPinned: row.is_pinned as boolean,
  };
}

// 목록 한 페이지. 고정 글(공지)은 1페이지 맨 위에만 따로 얹는다(건의게시판과 같은
// 규칙 — 매 페이지 반복하면 "몇 페이지에 있었더라"가 헷갈린다).
export async function fetchBoardPage({
  page,
  category,
  query,
}: {
  page: number;
  category?: string;
  query?: string;
}) {
  const admin = createAdminClient();
  const from = (page - 1) * BOARD_PAGE_SIZE;
  const activeCategory = isBoardCategory(category) ? category : null;
  const keyword = (query ?? "").trim();

  let listQuery = admin
    .from("board_posts")
    .select(LIST_COLUMNS, { count: "exact" })
    .eq("is_pinned", false);

  if (activeCategory) listQuery = listQuery.eq("category", activeCategory);
  if (keyword) {
    // 제목과 평문 본문 양쪽에서 찾는다. content_text 가 있는 이유가 이것이다 —
    // HTML 을 그대로 like 검색하면 태그 이름("span")이 검색어에 걸린다.
    // PostgREST or() 필터 문법의 구분자(, 괄호)·따옴표·역슬래시·like 와일드카드(%)는
    // 미리 털어낸다 — 남겨두면 검색어로 필터식을 조립하는 셈이 된다(공개 표라 새는
    // 것은 없지만, 깨진 필터는 오류 → 빈 결과로 나간다).
    const safe = keyword.replace(/[%,()"'\\]/g, " ").trim();
    if (safe) listQuery = listQuery.or(`title.ilike.%${safe}%,content_text.ilike.%${safe}%`);
  }

  const [{ data, count }, pinnedResult] = await Promise.all([
    listQuery.order("created_at", { ascending: false }).range(from, from + BOARD_PAGE_SIZE - 1),
    // 고정 글은 1페이지에서, 검색·말머리 필터가 없을 때만 얹는다(필터를 건 목록에
    // 상관없는 공지가 끼면 결과가 오염된다).
    page === 1 && !keyword && !activeCategory
      ? admin
          .from("board_posts")
          .select(LIST_COLUMNS)
          .eq("is_pinned", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as ListRow[] }),
  ]);

  const rows = [...((data ?? []) as ListRow[]), ...((pinnedResult.data ?? []) as ListRow[])];
  const avatars = await fetchAvatarUrls(rows.map((r) => r.user_id as string));

  const total = count ?? 0;
  return {
    items: ((data ?? []) as ListRow[]).map((row) => toListItem(row, avatars)),
    pinnedItems: ((pinnedResult.data ?? []) as ListRow[]).map((row) => toListItem(row, avatars)),
    total,
    totalPages: Math.max(1, Math.ceil(total / BOARD_PAGE_SIZE)),
  };
}

export async function fetchBoardPost(
  id: string,
  viewer: BoardViewer,
): Promise<BoardPostDetail | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("board_posts")
    .select(
      "id, user_id, nickname, category, title, content_html, view_count, comment_count, like_count, is_pinned, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;

  const ownership = { user_id: data.user_id as string };
  const avatars = await fetchAvatarUrls([ownership.user_id]);

  return {
    id: data.id as string,
    category: (isBoardCategory(data.category) ? data.category : "free") as BoardCategorySlug,
    title: data.title as string,
    contentHtml: data.content_html as string,
    nickname: data.nickname as string,
    avatarUrl: avatars.get(ownership.user_id) ?? null,
    authorId: ownership.user_id,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string | null,
    viewCount: data.view_count as number,
    commentCount: data.comment_count as number,
    likeCount: data.like_count as number,
    isPinned: data.is_pinned as boolean,
    canEdit: canEditBoardPost(ownership, viewer),
    canDelete: canDeleteBoardPost(ownership, viewer),
  };
}

// 조회수. 글쓴이 본인이 열어본 것은 세지 않는다(건의게시판과 같은 이유 — 자기 글을
// 몇 번 열었는지가 "몇 명이 봤나"에 섞이면 숫자의 뜻이 사라진다).
export async function countBoardView(id: string, viewer: BoardViewer, authorId: string) {
  if (viewer.userId === authorId) return;
  const admin = createAdminClient();
  await admin.rpc("increment_board_view", { p_post_id: id });
}

export async function fetchBoardComments(
  postId: string,
  viewer: BoardViewer,
): Promise<BoardCommentItem[]> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("board_comments")
    .select("id, parent_id, user_id, nickname, content, is_deleted, created_at, updated_at")
    .eq("post_id", postId)
    .order("created_at", { ascending: true });

  const rows = data ?? [];
  const avatars = await fetchAvatarUrls(rows.map((r) => r.user_id as string));

  const toItem = (row: (typeof rows)[number]): BoardCommentItem => {
    const ownership = { user_id: row.user_id as string };
    const isDeleted = row.is_deleted as boolean;
    return {
      id: row.id as string,
      parentId: (row.parent_id as string | null) ?? null,
      nickname: row.nickname as string,
      avatarUrl: avatars.get(ownership.user_id) ?? null,
      authorId: ownership.user_id,
      // 지워진 댓글은 본문을 내려보내지 않는다 — 화면에서 가리는 것으로 처리하면
      // HTML 소스에는 그대로 남는다.
      content: isDeleted ? "" : (row.content as string),
      createdAt: row.created_at as string,
      updatedAt: (row.updated_at as string | null) ?? null,
      isDeleted,
      canEdit: !isDeleted && canEditBoardComment(ownership, viewer),
      canDelete: !isDeleted && canDeleteBoardComment(ownership, viewer),
      replies: [],
    };
  };

  const items = rows.map(toItem);
  const byId = new Map(items.map((item) => [item.id, item]));
  const roots: BoardCommentItem[] = [];

  for (const item of items) {
    // 부모가 사라진 답글(경합으로 부모만 하드 삭제된 경우)은 원 댓글처럼 보여준다 —
    // 매달 자리가 없다고 통째로 감추면 쓴 사람만 억울하다.
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    if (parent) parent.replies.push(item);
    else roots.push(item);
  }

  // 답글만 남고 원 댓글이 지워진 자리는 "삭제된 댓글입니다"로 남아 있어야 맥락이
  // 유지되므로(board_comments.is_deleted) 여기서 걸러내지 않는다.
  return roots;
}

// 내가 이 글에 좋아요를 눌렀는지. 비로그인은 언제나 false.
export async function hasLikedBoardPost(postId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false;
  const admin = createAdminClient();
  const { data } = await admin
    .from("board_post_likes")
    .select("post_id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();
  return Boolean(data);
}

// ── 검색엔진에 보여줄 <head> 용 조회 ────────────────────────────────────────
//
// 동적 라우트(/board/[id])의 제목·정본이 셸의 <head> 에 실리려면 두 가지가 함께
// 있어야 한다(AGENTS.md·papers/[id] 주석):
//   (1) generateStaticParams 가 주소를 한 건 이상 알려줄 것
//   (2) generateMetadata 가 기다리는 조회가 전부 'use cache' + 공개 클라이언트일 것
// 세션 클라이언트(쿠키)를 쓰면 (2)가 깨져 셸에서 통째로 빠진다. board_posts 는
// 읽기가 공개 RLS 라 anon 클라이언트로 그대로 읽을 수 있다.
//
// 글이 새로 올라오거나 제목이 바뀌면 서버 액션이 revalidateTag("board-posts") 로
// 이 캐시를 깨운다(app/board/actions.ts).

// 빌드에서 미리 만들어 둘 글 수. 커뮤니티 글은 최신이 곧 사람이 들어오는 자리라
// 최신순 앞쪽만 실어도 충분하고, 나머지는 partialPrefetching 이 첫 방문 뒤
// 완성본으로 승격시킨다(next.config.ts 주석).
const PRERENDERED_POST_COUNT = 50;

export async function getRecentBoardPostIds(limit = PRERENDERED_POST_COUNT): Promise<string[]> {
  "use cache";
  cacheLife({ revalidate: 300 });
  cacheTag("board-posts");

  const supabase = createPublicClient();
  const { data } = await supabase
    .from("board_posts")
    .select("id")
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((row) => row.id as string);
}

export type BoardPostMeta = { title: string; description: string; category: string };

export async function getBoardPostMeta(id: string): Promise<BoardPostMeta | null> {
  "use cache";
  cacheLife({ revalidate: 300 });
  cacheTag("board-posts");

  const supabase = createPublicClient();
  const { data } = await supabase
    .from("board_posts")
    .select("title, content_text, category")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  return {
    title: data.title as string,
    description: boardPreviewText((data.content_text as string) ?? "", 150),
    category: data.category as string,
  };
}
