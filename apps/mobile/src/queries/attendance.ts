import { fetchAttendanceSummary, isAttendanceOpen, type AttendanceSummary } from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 월간 출석 카드(설계서 §6.2 출석 행 — RLS 읽기, core data/attendance.ts). 기능이 닫혀 있으면
// (전면 무료 이벤트, core isAttendanceOpen) 조회조차 하지 않는다 — 그릴 화면이 없다.
// 채점 성공 시 queries/cbt.ts 가 'attendance' 접두를 무효화한다.
export const attendanceKey = (userId: string) => ["me", userId, "attendance"] as const;

export function useAttendanceSummary() {
  const { userId } = useAuth();
  return useQuery<AttendanceSummary>({
    queryKey: attendanceKey(userId ?? ""),
    queryFn: () => fetchAttendanceSummary(supabase, userId!),
    enabled: !!userId && isAttendanceOpen(),
    staleTime: STALE.me,
  });
}
