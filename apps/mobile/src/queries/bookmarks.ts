import {
  fetchMyBookmarkedPaperIds,
  fetchMyBookmarkedSubjectIds,
  togglePaperBookmark,
  toggleSubjectBookmark,
  type PaperMyDetail,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { paperMyKey } from "./papers";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 즐겨찾기(문제지·과목) — RLS 직접, 낙관적 업데이트(onMutate) 후 되돌림(설계서 §4.5 #19).
// 퍼시스트 블롭은 JSON 이라 Set 대신 string[] 로 저장하고 화면에서 Set 으로 감싼다. 배열 순서 =
// 북마크한 순(최신 먼저, core fetch 가 created_at desc) — 낙관적 추가도 맨 앞에 넣는다.

export const bookmarksKey = (userId: string) => ["me", userId, "bookmarks"] as const;
export const subjectBookmarksKey = (userId: string) => ["me", userId, "subject-bookmarks"] as const;

function toggled(list: string[] | undefined, id: string, on: boolean): string[] {
  const rest = (list ?? []).filter((x) => x !== id);
  return on ? [id, ...rest] : rest;
}

export function useMyBookmarkedPaperIds() {
  const { userId } = useAuth();
  const query = useQuery<string[]>({
    queryKey: bookmarksKey(userId ?? ""),
    queryFn: async () => [...(await fetchMyBookmarkedPaperIds(supabase, userId!))],
    enabled: !!userId,
    staleTime: STALE.me,
  });
  const set = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { query, set };
}

export function useMyBookmarkedSubjectIds() {
  const { userId } = useAuth();
  const query = useQuery<string[]>({
    queryKey: subjectBookmarksKey(userId ?? ""),
    queryFn: async () => [...(await fetchMyBookmarkedSubjectIds(supabase, userId!))],
    enabled: !!userId,
    staleTime: STALE.me,
  });
  const set = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { query, set };
}

// 문제지 즐겨찾기 토글. 목록 캐시(['me',u,'bookmarks'])와 상세 캐시(['me',u,'paper',id]) 둘 다
// 즉시 바꾸고, 실패하면 스냅샷으로 되돌린다.
export function useTogglePaperBookmark() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ paperId }: { paperId: string; next: boolean }) => togglePaperBookmark(supabase, userId!, paperId),
    onMutate: async ({ paperId, next }) => {
      if (!userId) return undefined;
      const listKey = bookmarksKey(userId);
      const detailKey = paperMyKey(userId, paperId);
      await Promise.all([queryClient.cancelQueries({ queryKey: listKey }), queryClient.cancelQueries({ queryKey: detailKey })]);
      const prevList = queryClient.getQueryData<string[]>(listKey);
      const prevDetail = queryClient.getQueryData<PaperMyDetail>(detailKey);
      queryClient.setQueryData<string[]>(listKey, (list) => toggled(list, paperId, next));
      if (prevDetail) queryClient.setQueryData<PaperMyDetail>(detailKey, { ...prevDetail, isBookmarked: next });
      return { prevList, prevDetail };
    },
    onError: (_e, { paperId }, ctx) => {
      if (!userId || !ctx) return;
      queryClient.setQueryData(bookmarksKey(userId), ctx.prevList);
      if (ctx.prevDetail) queryClient.setQueryData(paperMyKey(userId, paperId), ctx.prevDetail);
    },
    onSuccess: (result, { paperId }) => {
      if (!userId) return;
      queryClient.setQueryData<string[]>(bookmarksKey(userId), (list) => toggled(list, paperId, result.bookmarked));
      queryClient.setQueryData<PaperMyDetail>(paperMyKey(userId, paperId), (prev) =>
        prev ? { ...prev, isBookmarked: result.bookmarked } : prev,
      );
    },
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: bookmarksKey(userId) });
    },
  });
}

export function useToggleSubjectBookmark() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ subjectId }: { subjectId: string; next: boolean }) => toggleSubjectBookmark(supabase, userId!, subjectId),
    onMutate: async ({ subjectId, next }) => {
      if (!userId) return undefined;
      const key = subjectBookmarksKey(userId);
      await queryClient.cancelQueries({ queryKey: key });
      const prev = queryClient.getQueryData<string[]>(key);
      queryClient.setQueryData<string[]>(key, (list) => toggled(list, subjectId, next));
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (userId && ctx) queryClient.setQueryData(subjectBookmarksKey(userId), ctx.prev);
    },
    onSuccess: (result, { subjectId }) => {
      if (!userId) return;
      queryClient.setQueryData<string[]>(subjectBookmarksKey(userId), (list) => toggled(list, subjectId, result.bookmarked));
    },
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: subjectBookmarksKey(userId) });
    },
  });
}
