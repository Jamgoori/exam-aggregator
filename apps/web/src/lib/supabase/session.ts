import "server-only";
import { createClient } from "@/lib/supabase/server";

// 서버 액션마다 반복되던 "클라이언트 생성 → 세션 사용자 조회" 보일러플레이트를
// 한 곳으로 모았다. user는 로그인하지 않았으면 null이고, 그때의 에러 메시지와
// 처리 방식(return vs redirect)은 호출부마다 달라서 여기서는 조회까지만 책임진다.
export async function getSessionUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

// 위와 같은 용도지만 인증 서버 왕복(getUser) 대신 JWT 를 로컬에서 검증한다(getClaims).
// 세션 갱신은 프록시가 맡고 실제 데이터 접근은 각 쿼리의 RLS 가 검증하므로, "누구인지"
// 만 필요한 조회(마이페이지·해설·CBT 진입·배지 폴링)에는 이쪽이면 충분하다 — 페이지
// 마다 100~300ms 짜리 왕복 하나가 빠진다. user_metadata·email 도 JWT 안에 있다.
//
// 계정 상태를 서버에서 확정해야 하는 쓰기(탈퇴·결제·닉네임 변경 등)는 계속
// getSessionUser 를 쓴다.
export type SessionClaims = {
  sub: string;
  email?: string;
  user_metadata?: Record<string, unknown>;
};

export async function getSessionClaims() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const raw = data?.claims;
  const claims: SessionClaims | null = raw?.sub
    ? {
        sub: raw.sub,
        email: raw.email as string | undefined,
        user_metadata: raw.user_metadata as Record<string, unknown> | undefined,
      }
    : null;
  return { supabase, claims };
}
