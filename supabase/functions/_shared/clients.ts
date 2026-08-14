import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { json } from "./cbt.ts";

// Edge 런타임이 자동 주입하는 환경변수. 서비스 롤 키는 함수 안에서만 쓰고 절대
// 클라이언트로 나가지 않는다.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// 공개 버킷(exam-papers) 저장 경로 → 공개 URL. 웹 storage.getPublicUrl 과 동형.
export function storagePublicUrl(path: string, bucket = "exam-papers"): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// 요청의 Authorization(사용자 JWT)로 본인을 확인하는 클라이언트.
export function userClientFrom(req: Request): SupabaseClient {
  const authHeader = req.headers.get("Authorization") ?? "";
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
}

// RLS 를 우회하는 관리자 클라이언트 — 정답 조회·응시 기록 쓰기 전용.
export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
}

// 공통: 로그인 사용자 확인. 없으면 401 응답을 반환한다(호출부에서 early return).
//
// email 을 같이 돌려주는 이유는 관리자 판정 때문이다 — admins 테이블은 user_id 가
// 아니라 email 이 기본키라(웹의 is_admin() 도 JWT 의 email 로 검사한다), 이걸 안 실어
// 주면 멤버십을 확인할 때마다 auth.admin.getUserById 를 한 번 더 부르게 된다.
export async function requireUser(
  req: Request,
): Promise<{ userId: string; email: string | null } | { error: Response }> {
  const {
    data: { user },
  } = await userClientFrom(req).auth.getUser();
  if (!user) return { error: json({ error: "로그인 후 이용할 수 있어요." }, 401) };
  return { userId: user.id, email: user.email ?? null };
}

// 비로그인도 허용하는 엔드포인트(해설 미리보기 등)용 — 없으면 null, 에러로 막지 않는다.
export async function getOptionalUser(
  req: Request,
): Promise<{ userId: string; email: string | null } | null> {
  const {
    data: { user },
  } = await userClientFrom(req).auth.getUser();
  return user ? { userId: user.id, email: user.email ?? null } : null;
}
