// 프로필 사진 공용 규칙.
//
// 이미지는 Supabase Storage 의 avatars 버킷(공개 읽기)에 올리고, 경로만
// profiles.avatar_path 와 auth.users.raw_user_meta_data.avatar_path 양쪽에 적어둔다.
// 닉네임과 같은 이중 기록이다 — 헤더는 JWT(getClaims)만 읽고 그리므로 메타데이터
// 쪽이 없으면 매 페이지마다 DB 왕복이 하나씩 붙는다.
//
// 사진이 없는 계정이 절대다수라, "없을 때"가 예외가 아니라 기본이다. 그래서 화면
// 컴포넌트는 언제나 닉네임 첫 글자 아바타를 그릴 수 있어야 한다(user-menu.tsx 의 Avatar).

export const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
// 저장되는 정사각형 한 변. 표시 최대 크기(마이페이지 96px)의 2배 이상이라 고해상도
// 화면에서도 흐리지 않고, 이보다 크게 두면 목록에 아바타가 수십 개 깔릴 때만 손해다.
export const AVATAR_SIZE = 256;

export const AVATAR_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export function isAllowedAvatarMime(mime: string): boolean {
  return (AVATAR_ALLOWED_MIME as readonly string[]).includes(mime);
}

// 업로드 전 클라이언트에서, 업로드 후 서버에서 같은 문구로 걸러낸다.
export function avatarUploadError(file: { type: string; size: number }): string | null {
  if (!isAllowedAvatarMime(file.type)) {
    return "JPG·PNG·WEBP·GIF 이미지만 올릴 수 있어요.";
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return `이미지는 ${Math.floor(AVATAR_MAX_BYTES / (1024 * 1024))}MB 이하로 올려주세요.`;
  }
  if (file.size === 0) return "이미지를 선택해주세요.";
  return null;
}

// 아바타에 넣을 글자. 이모지·서로게이트 쌍이 반으로 잘리지 않도록 코드포인트 단위로 자른다.
export function avatarInitial(nickname: string): string {
  return [...String(nickname ?? "").trim()][0] ?? "회";
}

// 서버가 만들어 넣는 경로의 모양. "{userId}/{uuid}.webp" 만 허용한다.
//
// user_metadata 는 로그인한 사용자가 supabase.auth.updateUser 로 **직접 바꿀 수 있는**
// 값이다(닉네임과 같은 사정). 헤더는 그 값을 그대로 <img src> 에 붙이므로, 모양을
// 여기서 잠가두지 않으면 같은 스토리지 호스트의 임의 경로(다른 버킷·쿼리 문자열)를
// 자기 아바타 자리에 불러오게 만들 수 있다. 값이 이 모양이 아니면 사진 없음으로 본다.
const AVATAR_PATH_RE = /^[A-Za-z0-9-]{1,64}\/[A-Za-z0-9-]{1,64}\.webp$/;

export function isValidAvatarPath(path: unknown): path is string {
  return typeof path === "string" && AVATAR_PATH_RE.test(path);
}

// 저장 경로 → 공개 URL. 버킷이 공개라 서명 없이 그대로 붙인다.
export function avatarPublicUrl(supabaseUrl: string, path: string | null | undefined): string | null {
  if (!isValidAvatarPath(path)) return null;
  return `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/avatars/${path}`;
}
