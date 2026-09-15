import { isFreeForAll, isPremiumMembership, type Membership, type MembershipGetResponse } from "@gongmoa/core";
import type { Session, User } from "@supabase/supabase-js";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { configureAuth } from "../lib/auth";
import { callEdge, handleEdgeError } from "../lib/edge";
import { currentAvatarUrl, currentNickname } from "../lib/profile";
import { queryClient, STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";

// 인증 컨텍스트(KEEP). 세션 + 헤더·드로어가 쓰는 표시값(웹 layout.tsx headerUser 와 같은 규칙:
// nickname ← user_metadata.nickname ?? 이메일 앞 ?? "회원", avatarUrl ← user_metadata.avatar_path).
//
// 멤버십은 EF membership-get 결과(설계서 §8.1 `useMembership()` — staleTime 60초, 메모리 전용,
// 로그인·포그라운드마다 재조회)를 여기서 함께 들고 다닌다. isPremium 은 웹 lib/membership.ts
// `isPremium` 과 같은 규칙: 관리자 ∥ core isPremiumMembership(전면 무료 기간 포함). 서버 행이
// 진실이므로 앱은 결과를 그릴 뿐이다.
type AuthContextValue = {
  session: Session | null;
  user: User | null;
  userId: string | null;
  loading: boolean;
  nickname: string;
  avatarUrl: string | null;
  isPremium: boolean;
  isAdmin: boolean;
  // 계정이 들고 있는 기간 그대로("언제까지" 표시용). 아직 안 받았으면 null.
  membership: Membership | null;
  // membership-get 응답을 아직 못 받은 상태(비로그인은 false).
  membershipLoading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  userId: null,
  loading: true,
  nickname: "회원",
  avatarUrl: null,
  isPremium: false,
  isAdmin: false,
  membership: null,
  membershipLoading: false,
});

// 멤버십 쿼리 옵션 — queries/membership.ts 의 useMembership() 과 여기(AuthProvider)가 같은 키·
// 정책을 쓴다. 키에 userId 가 들어가므로 로그인(계정 전환)마다 새로 받고, refetchOnWindowFocus
// (focusManager ← AppState)로 포그라운드마다 다시 받는다. meta.persist:false — 멤버십 행은
// 디스크에 남기지 않는다(AGENTS.md 금지선).
export const membershipKey = (userId: string) => ["me", userId, "membership"] as const;

export function membershipQueryOptions(userId: string | null): UseQueryOptions<MembershipGetResponse> {
  return {
    queryKey: membershipKey(userId ?? ""),
    queryFn: () => callEdge("membership-get", {}),
    enabled: !!userId,
    staleTime: STALE.membership,
    gcTime: STALE.membership,
    refetchOnWindowFocus: true,
    meta: { persist: false },
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    configureAuth();

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // 앱이 포그라운드로 돌아오면 토큰 자동 갱신 타이머를 다시 돌린다(백그라운드에선 멈춤).
    const appStateSub = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  const userId = session?.user.id ?? null;
  // 이 프로바이더는 QueryClientProvider 바깥(루트)에 있어 컨텍스트가 없다 — TanStack v5 의
  // 두 번째 인자로 싱글턴 queryClient 를 직접 넘긴다(퍼시스트 복원과 무관한 메모리 쿼리).
  const membershipQuery = useQuery(membershipQueryOptions(userId), queryClient);
  const membershipData = membershipQuery.data;

  // 여기서 부르는 membership-get 은 화면 호출부가 없어 오류가 handleEdgeError(§6.9: 401 → 로컬
  // signOut + 캐시 초기화 + /login, 426 → 강제 업데이트)에 닿지 않는다 — 효과로 한 번 넘긴다.
  // 그 외(네트워크·429)는 표시할 화면이 없으니 조용히 지나간다(다음 포커스에 재조회).
  const membershipError = membershipQuery.error;
  useEffect(() => {
    if (!membershipError) return;
    void handleEdgeError(membershipError);
  }, [membershipError]);

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const isAdmin = !!user && !!membershipData?.isAdmin;
    const membership = user ? (membershipData?.membership ?? null) : null;
    return {
      session,
      user,
      userId: user?.id ?? null,
      loading,
      nickname: currentNickname(meta) ?? user?.email?.split("@")[0] ?? "회원",
      avatarUrl: currentAvatarUrl(meta),
      // 웹 lib/membership.ts#isPremium: admin ∥ isPremiumMembership(membership) — 후자가 전면 무료
      // 기간(isFreeForAll)을 먼저 본다. 비로그인은 언제나 false(웹 headerUser 와 같은 자리).
      isPremium: !!user && (isAdmin || isPremiumMembership(membership) || isFreeForAll()),
      isAdmin,
      membership,
      membershipLoading: !!user && membershipQuery.isPending,
    };
  }, [session, loading, membershipData, membershipQuery.isPending]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
