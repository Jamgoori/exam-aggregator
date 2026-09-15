import { fetchAttemptDetail, fetchOwnWrongAnswers, type AttemptDetail, type OwnWrongAnswerItem } from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 응시 상세(`/mypage/attempts/[attemptId]`, 설계서 §5 행). 둘 다 메모리 전용(meta.persist:false —
// AGENTS.md "정답·해설·멤버십을 디스크에 남기지 말 것"): 정답(RPC own_wrong_answers)은 물론이고,
// 문항별 정오도 맞힌 문항의 selected_choice 가 곧 정답이라 디스크에 두면 채점 결과가 새는 셈이다
// (웹은 틀린 행만 받지만 앱은 "전체 문항 보기"로 맞힌 행까지 받는다).

export const attemptDetailKey = (userId: string, attemptId: string) => ["me", userId, "attempts", "detail", attemptId] as const;
export const ownWrongAnswersKey = (userId: string, sig: string) => ["me", userId, "own-wrong-answers", sig] as const;

// 없거나 남의 응시면 null(화면은 404).
export function useAttemptDetail(attemptId: string | null) {
  const { userId } = useAuth();
  return useQuery<AttemptDetail | null>({
    queryKey: attemptDetailKey(userId ?? "", attemptId ?? ""),
    queryFn: () => fetchAttemptDetail(supabase, userId!, attemptId!),
    enabled: !!userId && !!attemptId,
    staleTime: STALE.me,
    gcTime: STALE.me,
    meta: { persist: false },
  });
}

// `${paperId}#${questionNumber}` → 정답. 본인이 답한 문항만 온다. 앱 재시작 시 사라져야 정상.
export function useOwnWrongAnswers(items: OwnWrongAnswerItem[]) {
  const { userId } = useAuth();
  const sig = useMemo(() => items.map((i) => `${i.paperId}#${i.questionNumber}`).join(","), [items]);
  return useQuery<Record<string, number>>({
    queryKey: ownWrongAnswersKey(userId ?? "", sig),
    queryFn: () => fetchOwnWrongAnswers(supabase, items),
    enabled: !!userId && items.length > 0,
    staleTime: STALE.me,
    gcTime: STALE.me,
    meta: { persist: false },
  });
}
