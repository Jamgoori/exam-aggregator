import { attendanceDaysLeft, membershipDaysLeft, trialDaysLeft, type MembershipGetResponse } from "@gongmoa/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { membershipKey, membershipQueryOptions, useAuth } from "../providers/auth-provider";

export { membershipKey };

// 멤버십(EF membership-get) — 설계서 §6.3 멤버십 등급: `['me', userId, 'membership']`, staleTime
// 60초, 메모리 전용(meta.persist:false), 로그인(키에 userId)·포그라운드(refetchOnWindowFocus)·
// 채점(queries/cbt.ts INVALIDATE_AFTER_SUBMIT 'membership') 뒤 재조회. 옵션은 AuthProvider 와
// 공유한다(providers/auth-provider.tsx membershipQueryOptions) — 화면이 이 훅을 부르면 같은
// 캐시 항목을 본다.
export function useMembership() {
  const { userId } = useAuth();
  return useQuery<MembershipGetResponse>(membershipQueryOptions(userId));
}

// 화면이 "며칠 남았는지"를 그릴 때 쓰는 파생값(웹 mypage/page.tsx·membership/page.tsx 와 같은
// 규칙: 관리자에게는 남은 일수를 말하지 않는다).
export function useMembershipDays(now: Date = new Date()) {
  const { membership, isAdmin } = useAuth();
  return {
    daysLeft: isAdmin ? null : membershipDaysLeft(membership, now),
    trialDaysLeft: isAdmin ? null : trialDaysLeft(membership, now),
    attendanceDaysLeft: isAdmin ? null : attendanceDaysLeft(membership, now),
  };
}

export function useInvalidateMembership() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return () => {
    if (userId) void queryClient.invalidateQueries({ queryKey: membershipKey(userId) });
  };
}
