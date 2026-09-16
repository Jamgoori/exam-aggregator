import type { SupabaseClient } from "@supabase/supabase-js";
import { authorNickname } from "../nickname";
import { avatarBytesError, isValidAvatarPath } from "../avatar";

// 프로필 사진의 서버 규칙. 웹 서버 액션(app/actions.ts#uploadAvatar/removeAvatar)과
// Edge Function(avatar-upload)이 이 두 함수의 얇은 어댑터다 — 한쪽에만 규칙이 있으면
// 웹에서 올린 사진과 앱에서 올린 사진의 모양·정리 순서가 갈라진다.
//
// 인자 규칙:
//   client — service_role 클라이언트. avatars 버킷에는 쓰기 정책이 **없고**(schema.sql,
//            §6.1 금지선) profiles 는 본인 행만 보이는 RLS 라, 스토리지·profiles·
//            auth.users 셋 다 service_role 로만 만진다. 버킷을 열지 않는 이유가 바로
//            이것이다: 업로드가 반드시 이 함수를 지나야 규격 강제가 강제로 남는다.
//   webp   — **이미 구워진** 256px 정사각 webp 바이트. 굽는 일은 런타임마다 다르다
//            (웹은 sharp, 앱은 Skia — Deno 에는 sharp 가 없다). 규칙은 굽지 않고
//            avatarBytesError 로 **검사만** 한다(avatar.ts "구워진 WEBP 검사" 참고).
//
// 이미지 바이트를 이중 기록하는 곳이 셋이라 순서가 중요하다(웹 uploadAvatar 의 순서를
// 그대로 옮겼다): 검사 → 업로드 → profiles → user_metadata → **예전 사진 삭제는 맨 뒤**.
// 먼저 지웠다가 업로드가 실패하면 사진만 사라진 계정이 된다.

export type AvatarUploadInput = {
  userId: string;
  // 구워진 webp 바이트.
  webp: Uint8Array;
  // profiles 행이 아직 없을 때 함께 넣을 닉네임의 원본(user_metadata.nickname).
  // 행은 닉네임을 정할 때 만들어지지만 그 이전에 만들어진 계정에는 없을 수 있다 —
  // 없다고 사진 업로드가 실패하면 사용자로서는 이유를 알 길이 없다.
  metadataNickname?: unknown;
};

// 실패는 문구와 **HTTP 상태**를 함께 돌려준다. 상태를 규칙이 정하는 이유는 어댑터를
// 얇게 두기 위해서다 — Edge 가 문구를 정규식으로 갈라 400/500 을 고르기 시작하면
// 그게 곧 어댑터로 샌 규칙이다. 400 = 보낸 것이 잘못됐다(다시 고를 수 있다),
// 500 = 서버가 못 했다(사용자가 할 수 있는 게 없다). 웹 서버 액션은 문구만 쓴다.
export type AvatarChangeResult =
  | { error: string; status: 400 | 500 }
  | { avatarPath: string | null };

export type AvatarDeps = {
  // 저장 경로의 파일명. 테스트가 고정하려고 주입한다(기본값은 crypto.randomUUID).
  randomUuid?: () => string;
};

export async function uploadUserAvatar(
  client: SupabaseClient,
  input: AvatarUploadInput,
  deps: AvatarDeps = {},
): Promise<AvatarChangeResult> {
  const invalid = avatarBytesError(input.webp);
  if (invalid) return { error: invalid, status: 400 };

  const uuid = deps.randomUuid ?? (() => crypto.randomUUID());
  // isValidAvatarPath 가 허용하는 유일한 모양. 사용자 id 를 앞에 두면 탈퇴 정리
  // (account-delete)가 `list(userId)` 한 번으로 본인 객체만 골라낼 수 있다.
  const path = `${input.userId}/${uuid()}.webp`;

  const { error: uploadError } = await client.storage
    .from("avatars")
    .upload(path, input.webp, { contentType: "image/webp", cacheControl: "31536000" });
  if (uploadError) {
    // 원인을 화면에 그대로 내보내지는 않지만(스토리지 내부 사정이다) 로그에는 남긴다.
    console.error("[avatar] 업로드 실패:", uploadError.message);
    // 버킷이 없는 건 이용자가 다시 시도해서 풀릴 일이 아니라 설치가 덜 된 것이다.
    return {
      error: /bucket/i.test(uploadError.message)
        ? "이미지 저장소가 아직 준비되지 않았어요. 운영자에게 알려주세요."
        : "업로드에 실패했어요. 잠시 후 다시 시도해주세요.",
      status: 500,
    };
  }

  const { data: previous } = await client
    .from("profiles")
    .select("avatar_path")
    .eq("user_id", input.userId)
    .maybeSingle();

  const { error: profileError } = previous
    ? await client.from("profiles").update({ avatar_path: path }).eq("user_id", input.userId)
    : await client.from("profiles").insert({
        user_id: input.userId,
        nickname: authorNickname(await resolveNickname(client, input)),
        avatar_path: path,
      });
  if (profileError) {
    // 경로를 어디에도 적지 못했으므로 방금 올린 객체는 주인 없는 파일이다. 지운다.
    await client.storage.from("avatars").remove([path]);
    return { error: "저장에 실패했어요.", status: 500 };
  }

  await writeMetadataAvatarPath(client, input.userId, path);

  // 예전 사진은 새 사진이 자리를 잡은 뒤에 지운다.
  const stale = previous?.avatar_path as string | null | undefined;
  if (stale && stale !== path && isOwnAvatarPath(input.userId, stale)) {
    await client.storage.from("avatars").remove([stale]);
  }

  return { avatarPath: path };
}

export async function removeUserAvatar(
  client: SupabaseClient,
  input: { userId: string },
): Promise<AvatarChangeResult> {
  const { data: profile } = await client
    .from("profiles")
    .select("avatar_path")
    .eq("user_id", input.userId)
    .maybeSingle();

  const { error } = await client
    .from("profiles")
    .update({ avatar_path: null })
    .eq("user_id", input.userId);
  if (error) return { error: "삭제에 실패했어요.", status: 500 };

  await writeMetadataAvatarPath(client, input.userId, null);

  // 업로드와 같은 이유로 객체 삭제가 맨 뒤다 — 경로를 지우기 전에 파일을 지웠다가
  // 중간에 실패하면 "있다고 적혀 있는데 없는 사진"이 남아 깨진 이미지가 그려진다.
  const path = profile?.avatar_path as string | null | undefined;
  if (path && isOwnAvatarPath(input.userId, path)) {
    await client.storage.from("avatars").remove([path]);
  }

  return { avatarPath: null };
}

// 지울 객체가 정말 이 사람 것인지 한 번 더 본다. 지금 profiles 에는 authenticated 쓰기
// 정책이 없어서(schema.sql "insert/update는 서버 액션에서 service role로만") 이 컬럼에는
// 서버가 적은 값만 들어온다 — 그래서 오늘은 닿지 않는 분기다. 그래도 두는 이유는, 그 정책이
// 열리는 날 이 자리가 곧바로 **남의 사진 지우기**가 되기 때문이다: 자기 행의 avatar_path 에
// 남의 경로를 적어 두고 삭제·재업로드를 부르면 된다. 경로 앞머리가 곧 소유자라
// (avatar.ts AVATAR_PATH_RE) 검사는 한 줄이면 되고, 걸리면 지우지 않고 넘어간다 —
// 주인 없는 객체가 하나 남는 것이 남의 사진이 사라지는 것보다 낫다.
function isOwnAvatarPath(userId: string, path: string): boolean {
  return isValidAvatarPath(path) && path.startsWith(`${userId}/`);
}

// profiles 행을 새로 만들 때 넣을 닉네임의 원본. 웹은 세션에서 이미 읽어 둔 값을
// 넘기고(왕복 하나를 아낀다), Edge 에는 그 세션이 없어 여기서 admin 으로 읽는다.
// 이 경로는 "닉네임을 정하기 전에 만들어진 계정이 사진부터 올린" 드문 경우뿐이다.
async function resolveNickname(
  client: SupabaseClient,
  input: AvatarUploadInput,
): Promise<unknown> {
  if (input.metadataNickname !== undefined) return input.metadataNickname;
  const { data } = await client.auth.admin.getUserById(input.userId);
  return (data?.user?.user_metadata as { nickname?: unknown } | undefined)?.nickname;
}

// auth.users.raw_user_meta_data 쪽 사본. 화면에 뿌리는 값의 원본은 이쪽이다 —
// 헤더·앱 상단은 JWT 만 읽고 아바타를 그리므로(avatar.ts 머리말), 여기를 빼먹으면
// 페이지마다 DB 왕복이 하나씩 붙거나 예전 사진이 계속 남는다.
//
// service_role 의 admin API 를 쓴다. 웹은 사용자 세션으로도 고칠 수 있지만(닉네임과
// 같은 사정) Edge 에는 그 세션이 없어서, 규칙을 한 벌로 두려면 양쪽 다 admin 이어야
// 한다. user_metadata 는 top-level 키 단위로 병합되므로 nickname 등 다른 값은 남는다.
// 실패해도 되돌리지 않는다: profiles 에는 이미 적혔고 다음 로그인·새로고침에 맞춰진다.
async function writeMetadataAvatarPath(
  client: SupabaseClient,
  userId: string,
  path: string | null,
): Promise<void> {
  const { error } = await client.auth.admin.updateUserById(userId, {
    user_metadata: { avatar_path: path },
  });
  if (error) console.error("[avatar] user_metadata 갱신 실패:", error.message);
}
