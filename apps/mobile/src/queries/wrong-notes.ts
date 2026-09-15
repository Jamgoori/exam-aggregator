import {
  fetchUnresolvedCountBySubject,
  fetchWrongNoteGroupsForAttempts,
  sumUnresolved,
  type MyAttemptRow,
  type UnresolvedBySubject,
  type WrongNoteSubjectGroup,
} from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 오답노트 집계(설계서 §6.2 오답노트 행 — RLS 직접, 30초, 퍼시스트). 키 접두 ['me', u, 'wrong-notes']
// 는 채점 성공(queries/cbt.ts)과 오답노트 뮤테이션(Phase 2)이 통째로 무효화한다.
// 정답(RPC own_wrong_answers)은 queries/attempts.ts 의 메모리 전용 쿼리 — 여기 섞지 않는다.

export const unresolvedBySubjectKey = (userId: string) => ["me", userId, "wrong-notes", "unresolved-by-subject"] as const;
export const wrongNoteGroupsKey = (userId: string, attemptsSig: string) =>
  ["me", userId, "wrong-notes", "groups", attemptsSig] as const;

// 과목별 남은 오답(user_question_status 기준, 삭제 마크 제외). 무료 회원에게도 계산한다 —
// 상단 "남은 오답" 타일과 무료 회원 오답노트 탭의 과목 카드가 전부 이 값으로 그려진다.
export function useUnresolvedBySubject() {
  const { userId } = useAuth();
  const query = useQuery<UnresolvedBySubject[]>({
    queryKey: unresolvedBySubjectKey(userId ?? ""),
    queryFn: () => fetchUnresolvedCountBySubject(supabase, userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
  const total = useMemo(() => (query.data ? sumUnresolved(query.data) : 0), [query.data]);
  return { query, total };
}

// 과목 → 문제지 → 문항 그룹(극복 진행률). 웹처럼 프리미엄에게만 돌린다(무거운 집계) — enabled=false
// 면 과목 카드는 남은 오답만 그린다. 응시 목록이 바뀌면(id·수) 키가 바뀌어 다시 센다.
export function useWrongNoteGroups(attempts: MyAttemptRow[] | undefined, enabled: boolean) {
  const { userId } = useAuth();
  const sig = useMemo(() => (attempts ?? []).map((a) => a.id).join(","), [attempts]);
  return useQuery<WrongNoteSubjectGroup[]>({
    queryKey: wrongNoteGroupsKey(userId ?? "", sig),
    queryFn: () => fetchWrongNoteGroupsForAttempts(supabase, userId!, attempts ?? []),
    enabled: !!userId && enabled && !!attempts,
    staleTime: STALE.me,
  });
}
