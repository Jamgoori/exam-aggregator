import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { avatarPublicUrl, avatarUrlMap, AVATAR_PATHS_MAX, chunk } from "@gongmoa/core";

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
  // AVATAR_PATHS_MAX 명씩 **끊어서 전부** 물어본다 — 끊은 뒤 버리지 않는다.
  // 끊는 이유: .in() 은 PostgREST 쿼리스트링으로 나가므로 id 수백 개를 한 번에 넣으면
  // URL 길이에서 먼저 깨진다. 자르면 안 되는 이유: 게시판 댓글 조회
  // (lib/board.ts#fetchBoardComments)는 한 글의 댓글을 **상한 없이** 읽어서 넘기므로,
  // 작성자가 200명을 넘는 글에서 뒷줄 아바타가 조용히 사라진다.
  const rows: { user_id: string; avatar_path: string | null }[] = [];
  for (const ids of chunk(unique, AVATAR_PATHS_MAX)) {
    const { data } = await admin
      .from("profiles")
      .select("user_id, avatar_path")
      .in("user_id", ids)
      .not("avatar_path", "is", null);
    rows.push(...((data ?? []) as { user_id: string; avatar_path: string | null }[]));
  }

  // 행 → URL 변환은 core 한 곳(avatarUrlMap)이다. 경로 모양 검증을 한쪽만 빠뜨리면
  // 웹과 앱이 같은 계정에 다른 아바타를 그린다.
  return avatarUrlMap(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "", rows);
}
