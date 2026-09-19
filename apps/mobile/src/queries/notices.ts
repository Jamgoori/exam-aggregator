import type { NoticesWriteRequest, NoticesWriteResponse } from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INVALID_UUID_CODE } from "./board";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";

// 공지사항 조회·상세·댓글 — 웹 lib/notices.ts(조회)와 notices/actions.ts 의 댓글 어댑터의 앱 판
// (설계서 §6.2 "즐겨찾기·…·공지 댓글" 행, §6.7 notices-write).
//
// 읽기는 전부 공개 RLS(notices·notice_comments "public read")라 앱 세션(anon 키)으로 그대로 읽는다 —
// 웹도 createPublicClient 로 같은 표를 같은 조건으로 읽는다(로그인 여부와 무관하게 언제나 같은 값).
// 웹 fetchNoticeComments 는 보는 사람에 따라 달라지는 canEdit/canDelete 를 서버에서 계산해 항목에 넣어
// 주지만, 앱은 그 값을 공개 캐시(['catalog', …])에 섞지 않고 authorId 만 실어 화면이 core
// canEditNoticeComment/canDeleteNoticeComment 로 센다(queries/board.ts 와 같은 배치).
//
// 쓰기는 댓글 셋(작성·수정·삭제)뿐이고 전부 EF notices-write 다 — 시간당 30건·비속어·닉네임 확정·
// 본인/관리자 권한이 규칙 core rules/notices.ts 에 있고 웹 서버 액션이 같은 함수를 부른다. 원글
// 작성·수정·삭제(관리자 전용)는 앱에 없다(§5: "/notices/new, /notices/[id]/edit 없음").
//
// ── 캐시 키와 무효화 지도 ───────────────────────────────────────────────────
//   ['catalog','notices','list', page]     목록 한 페이지(1페이지는 고정글 포함)   퍼시스트 O
//   ['catalog','notices','notice', id]     공지 상세(본문 텍스트 포함)              퍼시스트 O
//   ['catalog','notices','comments', id]   댓글 평면 목록                            퍼시스트 O
//
//   댓글 작성/수정/삭제 → comments(id) 무효화(웹 revalidateNotice 의 router.refresh() 자리).
//   공지에는 댓글 수 컬럼이 없어 목록·상세는 건드릴 것이 없다.
//
// 공지·댓글은 공개 콘텐츠라 퍼시스트해도 된다(§6.5 금지 5종에 해당하지 않음). staleTime 은 게시판과 같은
// 이유로 카탈로그(5분)보다 짧게 — 목록·상세는 조회수가 사람이 드나들 때마다 바뀌고(60초), 댓글은 그보다
// 더 자주 바뀐다(본인 RLS 데이터 등급 30초).

export const NOTICES_PAGE_SIZE = 20;
const NOTICE_STALE_MS = 60_000;
const NOTICE_LIST_COLUMNS = "id, title, is_pinned, view_count, created_at";

export type NoticeListItem = {
  id: string;
  title: string;
  createdAt: string;
  viewCount: number;
  isPinned: boolean;
};

export type NoticePage = {
  items: NoticeListItem[];
  pinnedItems: NoticeListItem[];
  total: number;
  grandTotal: number;
  totalPages: number;
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

export type NoticeCommentItem = {
  id: string;
  authorId: string;
  nickname: string;
  content: string;
  createdAt: string;
  updatedAt: string | null;
};

export const noticeListKey = (page: number) => ["catalog", "notices", "list", page] as const;
export const noticeKey = (id: string) => ["catalog", "notices", "notice", id] as const;
export const noticeCommentsKey = (id: string) => ["catalog", "notices", "comments", id] as const;

type Row = Record<string, unknown>;

function toListItem(row: Row): NoticeListItem {
  return {
    id: row.id as string,
    title: row.title as string,
    createdAt: row.created_at as string,
    viewCount: row.view_count as number,
    isPinned: row.is_pinned as boolean,
  };
}

// 목록 한 페이지(웹 fetchNoticePage 1:1). 고정 공지는 1페이지에서만 맨 위에 따로 얹는다(건의게시판과
// 같은 이유 — 매 페이지 반복해서 보여주면 몇 페이지에 있었는지 헷갈린다). 번호 매김·페이지 수는 고정을
// 뺀 개수로, 화면의 "전체 N건"은 고정을 포함한 실제 등록 건수로 센다(웹 주석 그대로).
async function fetchNoticePage(page: number): Promise<NoticePage> {
  const from = (page - 1) * NOTICES_PAGE_SIZE;

  const [listResult, pinnedResult, pinnedCountResult] = await Promise.all([
    supabase
      .from("notices")
      .select(NOTICE_LIST_COLUMNS, { count: "exact" })
      .eq("is_pinned", false)
      .order("created_at", { ascending: false })
      .range(from, from + NOTICES_PAGE_SIZE - 1),
    page === 1
      ? supabase.from("notices").select(NOTICE_LIST_COLUMNS).eq("is_pinned", true).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[], error: null }),
    supabase.from("notices").select("id", { count: "exact", head: true }).eq("is_pinned", true),
  ]);
  if (listResult.error) throw new Error(`공지 목록 조회 실패: ${listResult.error.message}`);
  if (pinnedResult.error) throw new Error(`공지 목록 조회 실패: ${pinnedResult.error.message}`);
  if (pinnedCountResult.error) throw new Error(`공지 목록 조회 실패: ${pinnedCountResult.error.message}`);

  const total = listResult.count ?? 0;
  return {
    items: ((listResult.data ?? []) as Row[]).map(toListItem),
    pinnedItems: ((pinnedResult.data ?? []) as Row[]).map(toListItem),
    total,
    grandTotal: total + (pinnedCountResult.count ?? 0),
    totalPages: Math.max(1, Math.ceil(total / NOTICES_PAGE_SIZE)),
  };
}

export function useNoticePage(page: number) {
  return useQuery<NoticePage>({
    queryKey: noticeListKey(page),
    queryFn: () => fetchNoticePage(page),
    staleTime: NOTICE_STALE_MS,
  });
}

// 공지 상세(웹 fetchNotice). 없는 글은 null — 화면이 404(+not-found)로 그린다. uuid 가 아닌 id 도
// 웹처럼 "없는 글"이다(queries/board.ts INVALID_UUID_CODE 주석).
async function fetchNotice(id: string): Promise<NoticeDetail | null> {
  const { data, error } = await supabase
    .from("notices")
    .select("id, title, content, is_pinned, view_count, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    if (error.code === INVALID_UUID_CODE) return null;
    throw new Error(`공지 조회 실패: ${error.message}`);
  }
  if (!data) return null;
  const row = data as Row;
  return {
    id: row.id as string,
    title: row.title as string,
    content: row.content as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
    viewCount: row.view_count as number,
    isPinned: row.is_pinned as boolean,
  };
}

export function useNotice(id: string | undefined) {
  return useQuery<NoticeDetail | null>({
    queryKey: noticeKey(id ?? ""),
    queryFn: () => fetchNotice(id!),
    enabled: !!id,
    staleTime: NOTICE_STALE_MS,
  });
}

// 조회수(웹 countNoticeView 그대로). RPC 는 anon 도 실행할 수 있어(schema.sql) 게스트의 열람도 웹처럼
// 세고, 게시판과 달리 글쓴이 제외가 없다(원글은 운영자 글이라 "자기 글 열람" 문제가 없다). 실패는
// 삼킨다 — 조회수 하나 때문에 화면을 막을 이유가 없다.
export async function countNoticeView(noticeId: string): Promise<void> {
  await supabase.rpc("increment_notice_view", { p_notice_id: noticeId }).then(() => {}, () => {});
}

// 댓글 평면 목록(웹 fetchNoticeComments 의 조회 부분 — 답글 트리 없이 작성순 전부).
async function fetchNoticeComments(noticeId: string): Promise<NoticeCommentItem[]> {
  const { data, error } = await supabase
    .from("notice_comments")
    .select("id, user_id, nickname, content, created_at, updated_at")
    .eq("notice_id", noticeId)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`댓글 조회 실패: ${error.message}`);
  return ((data ?? []) as Row[]).map((row) => ({
    id: row.id as string,
    authorId: row.user_id as string,
    nickname: row.nickname as string,
    content: row.content as string,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? null,
  }));
}

export function useNoticeComments(noticeId: string | undefined) {
  return useQuery<NoticeCommentItem[]>({
    queryKey: noticeCommentsKey(noticeId ?? ""),
    queryFn: () => fetchNoticeComments(noticeId!),
    enabled: !!noticeId,
    staleTime: STALE.me,
  });
}

// 댓글 작성/수정/삭제(EF notices-write comment.*). 웹 서버 액션 createNoticeComment 등과 같은 규칙
// (core rules/notices.ts)을 부르는 다른 어댑터다. 오류는 EdgeError 그대로 던져 화면이 handleEdgeError 로
// 푼다(401 → 로그인 모달, 429 → "잠시 후 다시 시도해 주세요", 그 외는 서버 문구 그대로).
export function useNoticeCommentWrite(noticeId: string) {
  const queryClient = useQueryClient();
  return useMutation<NoticesWriteResponse, unknown, NoticesWriteRequest>({
    mutationFn: (req) => callEdge("notices-write", req),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: noticeCommentsKey(noticeId) });
    },
  });
}
