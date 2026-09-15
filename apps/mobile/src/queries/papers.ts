import {
  fetchCbtAvailability,
  fetchMyRoundCounts,
  fetchPaperById,
  fetchPaperMyDetail,
  fetchPaperPublicDetail,
  fetchPaperRoundComparisons,
  fetchRelatedPapers,
  postDifficultyRating,
  type ExamPaper,
  type PaperMyDetail,
  type PaperPublicDetail,
  type PaperRoundComparison,
  type RelatedPapers,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { dedupModeFor, signalsProviderFor } from "./catalog";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 문제지 상세·목록 카드 보조 데이터. 키 접두: 공개 데이터 ['catalog', …], 본인 RLS 데이터
// ['me', userId, …](설계서 §6.3). 퍼시스트 블롭은 JSON 이라 Map/Set 대신 Record/배열로 둔다.

export const paperKey = (id: string) => ["catalog", "paper", id] as const;
export const paperPublicKey = (id: string) => ["catalog", "paper-public", id] as const;
export const paperMyKey = (userId: string, id: string) => ["me", userId, "paper", id] as const;
export const myRoundCountsKey = (userId: string) => ["me", userId, "round-counts"] as const;

export function usePaper(id: string | null) {
  return useQuery<ExamPaper | null>({
    queryKey: paperKey(id ?? ""),
    queryFn: () => fetchPaperById(supabase, id!),
    enabled: !!id,
    staleTime: STALE.catalog,
  });
}

// 댓글·난이도 집계·정답표·CBT 지원·회독 평균 — 누구나. 댓글이 바뀌므로 30초 등급.
export function usePaperPublicDetail(paper: ExamPaper | null | undefined) {
  return useQuery<PaperPublicDetail>({
    queryKey: paperPublicKey(paper?.id ?? ""),
    queryFn: () => fetchPaperPublicDetail(supabase, paper!),
    enabled: !!paper,
    staleTime: STALE.me,
  });
}

// 즐겨찾기·내 난이도·내 응시·해설 유무 — 로그인 사용자만(paper_explanation_counts 가
// authenticated 전용).
export function usePaperMyDetail(paper: ExamPaper | null | undefined) {
  const { userId } = useAuth();
  return useQuery<PaperMyDetail>({
    queryKey: paperMyKey(userId ?? "", paper?.id ?? ""),
    queryFn: () => fetchPaperMyDetail(supabase, paper!, userId!),
    enabled: !!paper && !!userId,
    staleTime: STALE.me,
  });
}

// 문제지별 응시 횟수(N회독 배지). 비로그인은 빈 객체.
export function useMyRoundCounts() {
  const { userId } = useAuth();
  return useQuery<Record<string, number>>({
    queryKey: myRoundCountsKey(userId ?? ""),
    queryFn: async () => Object.fromEntries(await fetchMyRoundCounts(supabase, userId!)),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// 화면에 보이는 문제지들의 "바로 풀기" 가능 여부(has_cbt_answers_bulk). 카탈로그가 cbtMask
// 를 이미 들고 있는 /papers 는 쓰지 않고, 과목 페이지·관련 목록처럼 별도 조회한 카드용.
export function useCbtAvailability(paperIds: string[]) {
  const key = useMemo(() => [...paperIds].sort().join(","), [paperIds]);
  const query = useQuery<string[]>({
    queryKey: ["catalog", "cbt-availability", key],
    queryFn: async () => [...(await fetchCbtAvailability(supabase, paperIds))],
    enabled: paperIds.length > 0,
    staleTime: STALE.catalog,
  });
  const set = useMemo(() => new Set(query.data ?? []), [query.data]);
  return { query, set };
}

// 하단 "같은 과목 기출문제 목록"(12개).
export function useRelatedPapers(paper: ExamPaper | null | undefined, level: string | undefined, examTypeIds: string[]) {
  const { userId } = useAuth();
  const examTypesKey = useMemo(() => [...examTypeIds].sort().join(","), [examTypeIds]);
  return useQuery<RelatedPapers | null>({
    queryKey: ["catalog", "related", paper?.id ?? "", level ?? "", examTypesKey, dedupModeFor(userId)],
    queryFn: () => fetchRelatedPapers(supabase, paper!, { level, examTypeIds }, signalsProviderFor(userId)),
    enabled: !!paper,
    staleTime: STALE.catalog,
  });
}

// 회독별 나 vs 다른 회원 평균(RPC paper_round_score_stats — authenticated 전용, 프리미엄
// 검사 없음, 웹과 동일). 로그인 사용자만 부른다.
export function usePaperRoundComparisons(
  paperId: string | null,
  rounds: { round: number; score: number; totalQuestions: number }[],
) {
  const { userId } = useAuth();
  return useQuery<PaperRoundComparison[] | null>({
    queryKey: ["me", userId ?? "", "round-compare", paperId ?? "", rounds.length],
    queryFn: () => fetchPaperRoundComparisons(supabase, paperId!, rounds),
    enabled: !!userId && !!paperId && rounds.length > 0,
    staleTime: STALE.me,
  });
}

// 체감 난이도 투표(RLS insert). 성공 시 공개 집계·내 점수 캐시를 갱신한다.
export function usePostDifficultyRating(paperId: string) {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (score: number) => postDifficultyRating(supabase, userId!, paperId, score),
    onSuccess: (result, score) => {
      queryClient.setQueryData<PaperPublicDetail>(paperPublicKey(paperId), (prev) =>
        prev ? { ...prev, averageScore: result.averageScore, voteCount: result.voteCount } : prev,
      );
      if (userId) {
        queryClient.setQueryData<PaperMyDetail>(paperMyKey(userId, paperId), (prev) =>
          prev ? { ...prev, myScore: score } : prev,
        );
      }
    },
  });
}
