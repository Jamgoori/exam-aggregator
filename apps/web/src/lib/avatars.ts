import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { avatarPublicUrl } from "@gongmoa/core";

// 프로필 사진 경로 → 공개 URL. 버킷이 public 이라 서명 없이 그대로 붙는다.
//
// 게시판 목록·댓글처럼 **남의** 아바타를 그려야 하는 자리는 auth.users 를 직접 볼
// 수 없으므로(공개 API 로 조회 불가) profiles.avatar_path 를 창구로 쓴다. 내 아바타는
// JWT(user_metadata.avatar_path)에 이미 들어 있어 DB 를 다시 보지 않는다.

export function avatarUrl(path: string | null | undefined): string | null {
  return avatarPublicUrl(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", path);
}

// 사용자 id 여러 개의 아바타 URL을 한 번에 읽는다. 게시판 목록 30줄에 아바타가
// 붙는데 줄마다 조회를 돌면 그게 곧 N+1 이다.
//
// profiles 는 본인 행만 select 할 수 있는 RLS 라(관리자 예외) 여기서는 admin
// 클라이언트로 읽는다. 내려보내는 값은 아바타 URL 하나뿐이고, 그건 이미 게시판
// 화면에 공개로 붙는 값이라 새로 새는 정보가 없다.
export async function fetchAvatarUrls(
  userIds: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("user_id, avatar_path")
    .in("user_id", unique)
    .not("avatar_path", "is", null);

  const map = new Map<string, string>();
  for (const row of data ?? []) {
    const url = avatarUrl(row.avatar_path as string | null);
    if (url) map.set(row.user_id as string, url);
  }
  return map;
}
