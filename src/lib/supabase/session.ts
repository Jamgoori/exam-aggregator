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
