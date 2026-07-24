import "server-only";
import { createClient } from "@supabase/supabase-js";

// service_role 키를 사용하는 서버 전용 클라이언트. RLS를 우회하므로 반드시
// 서버 액션/라우트 핸들러 안에서, 자체적으로 권한 검증을 마친 뒤에만 사용할 것.
// 절대 클라이언트 컴포넌트에서 import 하지 말 것 (server-only로 강제됨).
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
