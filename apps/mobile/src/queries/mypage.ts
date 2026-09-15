import {
  computeAttemptRounds,
  computeStreakDays,
  fetchDiagnosisEligibility,
  fetchMyAttempts,
  type DiagnosisEligibility,
  type MyAttemptRow,
  fetchWeeklyDiagnosisStatus,
  type WeeklyDiagnosisStatus,
} from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 마이페이지(설계서 §5 `/mypage`) 본인 RLS 데이터 — 키 접두 ['me', userId, …], 30초 등급,
// 디스크 퍼시스트(오프라인 표시용). 채점 성공 시 queries/cbt.ts 가 'attempts'·'diagnosis-eligibility'
// 접두를 무효화한다. 여기에는 정답·해설·멤버십이 없다(멤버십은 queries/membership.ts).

export const attemptsKey = (userId: string) => ["me", userId, "attempts"] as const;
export const diagnosisEligibilityKey = (userId: string) => ["me", userId, "diagnosis-eligibility"] as const;
export const weeklyDiagnosisKey = (userId: string) => ["me", userId, "diagnosis-weekly"] as const;

// 내 CBT 응시 전체(최신순) — 시험기록 탭·"N회독"·스트릭·즐겨찾기 카드 회독 배지가 함께 쓴다.
export function useMyAttempts() {
  const { userId } = useAuth();
  return useQuery<MyAttemptRow[]>({
    queryKey: attemptsKey(userId ?? ""),
    queryFn: () => fetchMyAttempts(supabase, userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// 응시 목록에서 파생하는 순수 계산(core). Map 은 퍼시스트가 안 되므로 캐시가 아니라 화면에서 만든다.
export function useAttemptRounds(attempts: MyAttemptRow[] | undefined) {
  return useMemo(() => computeAttemptRounds(attempts ?? []), [attempts]);
}

export function useStreakDays(attempts: MyAttemptRow[] | undefined) {
  return useMemo(() => computeStreakDays((attempts ?? []).map((a) => a.created_at)), [attempts]);
}

// 상단 "다음 행동" 카드용 진단 자격(응시 3회 또는 오답 15개).
export function useDiagnosisEligibility() {
  const { userId } = useAuth();
  return useQuery<DiagnosisEligibility>({
    queryKey: diagnosisEligibilityKey(userId ?? ""),
    queryFn: () => fetchDiagnosisEligibility(supabase, userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}

// 이번 주기 진단 유무(ready/pending/null). 리포트 본문은 받지 않는다.
export function useWeeklyDiagnosisStatus() {
  const { userId } = useAuth();
  return useQuery<WeeklyDiagnosisStatus | null>({
    queryKey: weeklyDiagnosisKey(userId ?? ""),
    queryFn: () => fetchWeeklyDiagnosisStatus(supabase, userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
}
