import type { Session } from "@supabase/supabase-js";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { AppState } from "react-native";
import { supabase } from "../lib/supabase";
import { configureGoogle } from "../lib/auth";

type AuthContextValue = {
  session: Session | null;
  loading: boolean;
};

const AuthContext = createContext<AuthContextValue>({
  session: null,
  loading: true,
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 실패해도 무시 — 구글 설정이 없거나 네이티브 모듈이 없으면 false 를 준다.
    configureGoogle();

    let alive = true;

    // 저장소(Keychain/Keystore) 오류로 reject 되면 loading 이 영원히 true 가 돼
    // 스피너에서 멈춘다. 세션 없음으로 간주하고 진행한다.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
      })
      .catch(() => {})
      .finally(() => {
        if (alive) setLoading(false);
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
      alive = false;
      sub.subscription.unsubscribe();
      appStateSub.remove();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
