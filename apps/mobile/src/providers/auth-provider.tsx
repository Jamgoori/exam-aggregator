import { isFreeForAll } from "@gongmoa/core";
import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { AppState } from "react-native";
import { configureAuth } from "../lib/auth";
import { currentAvatarUrl, currentNickname } from "../lib/profile";
import { supabase } from "../lib/supabase";

// 인증 컨텍스트(KEEP). 세션 + 헤더·드로어가 쓰는 표시값(웹 layout.tsx headerUser 와 같은 규칙:
// nickname ← user_metadata.nickname ?? 이메일 앞 ?? "회원", avatarUrl ← user_metadata.avatar_path).
// isPremium 은 membership-get 쿼리(Phase 1a /membership 화면)가 붙기 전까지 전면 무료 기간
// 판정(isFreeForAll)만 쓴다 — 서버 행이 진실이므로 앱은 결과를 그릴 뿐이다.
type AuthContextValue = {
  session: Session | null;
  user: User | null;
  userId: string | null;
  loading: boolean;
  nickname: string;
  avatarUrl: string | null;
  isPremium: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  user: null,
  userId: null,
  loading: true,
  nickname: "회원",
  avatarUrl: null,
  isPremium: false,
});

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

  const value = useMemo<AuthContextValue>(() => {
    const user = session?.user ?? null;
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    return {
      session,
      user,
      userId: user?.id ?? null,
      loading,
      nickname: currentNickname(meta) ?? user?.email?.split("@")[0] ?? "회원",
      avatarUrl: currentAvatarUrl(meta),
      isPremium: !!user && isFreeForAll(),
    };
  }, [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
