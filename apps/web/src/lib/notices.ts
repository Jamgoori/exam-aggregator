import "server-only";
import { createPublicClient } from "@/lib/supabase/public";
import { getSessionUser } from "@/lib/supabase/session";

export const NOTICES_PAGE_SIZE = 20;
const NOTICE_LIST_COLUMNS = "id, title, is_pinned, view_count, created_at";

// notices는 exam_papers처럼 완전히 공개된 테이블이라(RLS: public read) 로그인
// 여부와 무관하게 항상 같은 값을 보여준다. createPublicClient는 쿠키를 건드리지
// 않아 캐시 함수 안에서도 안전하게 쓸 수 있다.
export type NoticeListItem = {
  id: string;
  title: string;
  createdAt: string;
  viewCount: number;
  isPinned: boolean;
};

export type NoticeDetail = {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  viewCount: number;
  isPinned: boolean;
};

function toListItem(row: {
  id: unknown;
  title: unknown;
  is_pinned: unknown;
  view_count: unknown;
  created_at: unknown;
}): NoticeListItem {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    isPinned: row.is_pinned as boolean,
  };
}

// 이 게시판에서 글쓰기 버튼(및 상세의 수정·삭제 버튼)을 보여줄지만 결정한다 —
// 실제 쓰기 권한은 RLS(is_admin())와 서버 액션이 다시 검사한다.
export async function isNoticeAdmin(): Promise<boolean> {
  const { supabase, user } = await getSessionUser();
  if (!user) return false;
  const { data } = await supabase.rpc("is_admin");
  return data === true;
}

// 고정 공지는 페이지 1에서만 목록 맨 위에 따로 얹어 보여준다(suggestions와 같은
// 이유 — 매 페이지 반복해서 보여주면 몇 페이지에 있었는지 헷갈린다). 일반 글의
// 번호 매김·페이지 수는 공지를 뺀 개수로만 계산한다.
export async function fetchNoticePage(page: number) {
  const supabase = createPublicClient();
  const from = (page - 1) * NOTICES_PAGE_SIZE;

  const [{ data, count }, pinnedResult] = await Promise.all([
    supabase
      .from("notices")
      .select(NOTICE_LIST_COLUMNS, { count: "exact" })
      .eq("is_pinned", false)
      .order("created_at", { ascending: false })
      .range(from, from + NOTICES_PAGE_SIZE - 1),
    page === 1
      ? supabase
          .from("notices")
          .select(NOTICE_LIST_COLUMNS)
          .eq("is_pinned", true)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as unknown[] }),
  ]);

  const total = count ?? 0;
  const items = (data ?? []).map((row) => toListItem(row));
  const pinnedItems = (pinnedResult.data ?? []).map((row) =>
    toListItem(row as Parameters<typeof toListItem>[0]),
  );

  return {
    items,
    pinnedItems,
    total,
    totalPages: Math.max(1, Math.ceil(total / NOTICES_PAGE_SIZE)),
  };
}

export async function fetchNotice(id: string): Promise<NoticeDetail | null> {
  const supabase = createPublicClient();
  const { data } = await supabase
    .from("notices")
    .select("id, title, content, is_pinned, view_count, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (!data) return null;

  return {
    id: data.id as string,
    title: data.title as string,
    content: data.content as string,
    createdAt: data.created_at as string,
    updatedAt: data.updated_at as string | null,
    viewCount: data.view_count as number,
    isPinned: data.is_pinned as boolean,
  };
}

// 조회수. 증가 함수는 anon/authenticated에 실행 권한이 열려 있으므로(schema.sql)
// 별도 admin 클라이언트 없이 공개 클라이언트로 호출한다.
export async function countNoticeView(id: string) {
  const supabase = createPublicClient();
  await supabase.rpc("increment_notice_view", { p_notice_id: id });
}
