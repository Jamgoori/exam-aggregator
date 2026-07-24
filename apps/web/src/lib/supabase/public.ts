import "server-only";
import { createClient } from "@supabase/supabase-js";

// 쿠키/세션과 무관하게 완전히 공개된(anon) 데이터만 읽는 무상태 클라이언트.
// cookies()를 안 건드리므로 unstable_cache로 감싼 함수 안에서도 안전하게 만들 수
// 있다 — 홈 화면 통계처럼 로그인 여부와 무관하게 모두에게 같은 값을 캐싱해서
// 보여줄 때 쓴다.
export function createPublicClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false } },
  );
}
