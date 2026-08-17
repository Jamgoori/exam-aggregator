import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import {
  canDeleteSuggestion,
  canEditSuggestion,
  canReadSuggestion,
  suggestionListTitle,
  type SuggestionViewer,
} from "@gongmoa/core";

export const SUGGESTIONS_PAGE_SIZE = 20;
const SUGGESTIONS_LIST_COLUMNS =
  "id, user_id, nickname, title, is_secret, is_pinned, view_count, answer, created_at";

// 화면에 내려보내는 목록 한 줄. 볼 수 없는 비밀글은 여기서 이미 제목이 지워진
// 상태로 만들어진다 — "가리기"를 컴포넌트에 맡기면 언젠가 한 군데가 그냥 title 을
// 그려버린다(그 순간 남의 비밀글 제목이 HTML 에 실려 나간다).
export type SuggestionListItem = {
  id: string;
  title: string;
  nickname: string;
  createdAt: string;
  viewCount: number;
  isSecret: boolean;
  isPinned: boolean;
  isAnswered: boolean;
  // 자물쇠 아이콘을 회색(못 봄)/파랑(내 글)으로 나눠 그리는 데만 쓴다.
  readable: boolean;
};

export type SuggestionDetail = {
  id: string;
  title: string;
  content: string;
  nickname: string;
  createdAt: string;
  updatedAt: string | null;
  viewCount: number;
  isSecret: boolean;
  isPinned: boolean;
  answer: string | null;
  answeredAt: string | null;
  authorId: string;
  canEdit: boolean;
  canDelete: boolean;
};

// suggestions 는 RLS 로 모든 클라이언트 읽기를 막아 뒀다(schema.sql 참고). 대신
// 여기서 service_role 로 읽고, 볼 권한이 없는 값은 내려보내기 전에 지운다.
export async function getSuggestionViewer(): Promise<
  SuggestionViewer & { loggedIn: boolean }
> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { userId: null, isAdmin: false, loggedIn: false };

  const { data } = await supabase.rpc("is_admin");
  return { userId: user.id, isAdmin: data === true, loggedIn: true };
}

function toListItem(
  row: {
    id: unknown;
    user_id: unknown;
    nickname: unknown;
    title: unknown;
    is_secret: unknown;
    is_pinned: unknown;
    view_count: unknown;
    answer: unknown;
    created_at: unknown;
  },
  viewer: SuggestionViewer,
): SuggestionListItem {
  const post = {
    user_id: row.user_id as string,
    is_secret: row.is_secret as boolean,
    title: row.title as string,
  };
  return {
    id: row.id as string,
    title: suggestionListTitle(post, viewer),
    nickname: row.nickname as string,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    isSecret: post.is_secret,
    isPinned: row.is_pinned as boolean,
    isAnswered: (row.answer as string | null) !== null,
    readable: canReadSuggestion(post, viewer),
  };
}

// 고정 공지는 페이지 1에서만 목록 맨 위에 따로 얹어 보여준다 — 매 페이지마다
// 반복해서 보여주면 "몇 번째 페이지에 있었더라"를 헷갈리게 한다. 일반 글의 번호
// 매김·페이지 수는 공지를 뺀 개수로만 계산해, 공지가 몇 건 늘어도 흔들리지 않는다.
export async function fetchSuggestionPage(page: number, viewer: SuggestionViewer) {
  const admin = createAdminClient();
  const from = (page - 1) * SUGGESTIONS_PAGE_SIZE;

  const [{ data, count }, pinnedResult] = await Promise.all([
    admin
      .from("suggestions")
      .select(SUGGESTIONS_LIST_COLUMNS, { count: "exact" })
      .eq("is_pinned", false)
      .order("created_at", { ascending: false })
      .range(from, from + SUGGESTIONS_PAGE_SIZE - 1),
    page === 1
      ? admin
          .from("suggestions")
          .select(SUGGESTIONS_LIST_COLUMNS)
          .eq("is_pinned", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const total = count ?? 0;
  const items = (data ?? []).map((row) => toListItem(row, viewer));
  const pinnedItems = (pinnedResult.data ?? []).map((row) =>
    toListItem(row as Parameters<typeof toListItem>[0], viewer),
  );

  return {
    items,
    pinnedItems,
    total,
    totalPages: Math.max(1, Math.ceil(total / SUGGESTIONS_PAGE_SIZE)),
  };
}

export type FetchSuggestionResult =
  | { status: "ok"; suggestion: SuggestionDetail }
  | { status: "not_found" }
  | { status: "forbidden" };

export async function fetchSuggestion(
  id: string,
  viewer: SuggestionViewer,
): Promise<FetchSuggestionResult> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("suggestions")
    .select(
      "id, user_id, nickname, title, content, is_secret, is_pinned, view_count, answer, answered_at, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (!data) return { status: "not_found" };

  const post = { user_id: data.user_id as string, is_secret: data.is_secret as boolean };
  if (!canReadSuggestion(post, viewer)) return { status: "forbidden" };

  return {
    status: "ok",
    suggestion: {
      id: data.id as string,
      title: data.title as string,
      content: data.content as string,
      nickname: data.nickname as string,
      createdAt: data.created_at as string,
      updatedAt: data.updated_at as string | null,
      viewCount: data.view_count as number,
      isSecret: post.is_secret,
      isPinned: data.is_pinned as boolean,
      answer: data.answer as string | null,
      answeredAt: data.answered_at as string | null,
      authorId: post.user_id,
      canEdit: canEditSuggestion(post, viewer),
      canDelete: canDeleteSuggestion(post, viewer),
    },
  };
}

// 조회수. 내 글을 내가 열어본 것과 관리자 확인은 세지 않는다 — 그걸 세면 답변을
// 쓰는 동안 조회수만 올라가서 "몇 명이 이 건의를 봤나"라는 원래 의미가 없어진다.
export async function countSuggestionView(id: string, viewer: SuggestionViewer, authorId: string) {
  if (viewer.isAdmin || viewer.userId === authorId) return;
  const admin = createAdminClient();
  await admin.rpc("increment_suggestion_view", { p_suggestion_id: id });
}
