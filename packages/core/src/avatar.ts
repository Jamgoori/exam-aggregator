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

// ── 구워진 WEBP 검사 — 서버가 클라이언트를 믿지 않는 자리 ───────────────────
//
// 웹은 서버에서 sharp 로 256px webp 를 굽는다. **Deno(Edge)에는 sharp 가 없다.**
// WASM 이미지 코덱을 Edge 에 넣는 선택지도 있었지만 콜드스타트와 메모리가 요청마다
// 붙는다 — 아바타 하나 올리자고 치를 비용이 아니다. 그래서 이 라운드의 방침은
// **앱이 굽고(이미 들어 있는 @shopify/react-native-skia — 새 네이티브 의존은 OTA 를
// 깬다), 서버가 검사한다** 이다.
//
// 검사는 디코딩이 아니다. 헤더 앞 30바이트만 읽어 셋을 본다:
//   (1) 정말 RIFF....WEBP 인가        — 확장자·MIME 는 클라이언트가 부르는 이름일 뿐이다.
//   (2) 가로·세로가 AVATAR_SIZE 이하의 정사각형인가 — 웹(sharp cover 256×256)과 같은 결과물.
//   (3) 애니메이션이 아닌가            — 웹은 sharp 가 첫 프레임만 쓴다(움직이는 프로필
//                                        사진은 목록에서 눈이 그쪽으로만 끌린다).
// 디코딩을 하지 않으므로 압축 폭탄(작은 파일이 펼치면 수 GB)도 여기서는 위험이 아니다.
// 대신 **픽셀 수 상한을 헤더에서 직접 읽어** 거절하는 것이라 sharp 의 limitInputPixels
// 와 같은 자리를 지킨다.

// 구워진 결과의 바이트 상한. 원본 상한(AVATAR_MAX_BYTES 5MB)과 **별개**다 — 그쪽은
// 사용자가 앨범에서 고른 사진의 크기고, 이쪽은 256px 로 구워 나온 결과의 크기다.
// 실제로는 10~40KB 지만, 무손실(VP8L)·알파 채널로 구워지면 몇 배가 되므로 512KB 로
// 넉넉히 둔다. 이 값이 있어야 "정상적인 256px webp" 로 위장한 큰 파일을 버킷에 넣는
// 경로가 막힌다(버킷 자체의 5MB 제한은 너무 헐겁다).
export const AVATAR_ENCODED_MAX_BYTES = 512 * 1024;

// base64 로 실어 보낼 때의 문자 수 상한. base64 는 3바이트를 4글자로 늘리므로 약 33%
// 부푼다 — 바이트 상한을 그대로 쓰면 정상 크기의 이미지가 거절된다. 디코딩 **전에**
// 이 값으로 먼저 거르는 것은, 거대한 문자열을 굳이 바이트 배열로 펼치지 않기 위해서다.
export const AVATAR_BASE64_MAX_CHARS = Math.ceil(AVATAR_ENCODED_MAX_BYTES / 3) * 4;

// 아바타 경로를 한 번에 물어볼 수 있는 사용자 수. 댓글 한 페이지(30줄)·게시판 목록(30줄)에
// 넉넉하고, 그 이상은 "목록 하나를 그린다"가 아니라 전수 수집이다. 웹 fetchAvatarUrls 는 이
// 크기로 **끊어서 전부** 물어본다(자르지 않는다) — 사용자 id 수백 개를 한 요청에 넣으면
// PostgREST 는 그것을 쿼리스트링으로 만들기 때문에 URL 길이에서 먼저 깨진다.
export const AVATAR_PATHS_MAX = 200;

export type WebpInfo = { width: number; height: number; animated: boolean };

function u16(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8);
}

function u24(bytes: Uint8Array, at: number): number {
  return bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16);
}

function u32(bytes: Uint8Array, at: number): number {
  return (
    (bytes[at] | (bytes[at + 1] << 8) | (bytes[at + 2] << 16) | (bytes[at + 3] << 24)) >>> 0
  );
}

function ascii(bytes: Uint8Array, at: number, len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) out += String.fromCharCode(bytes[at + i]);
  return out;
}

// RIFF 컨테이너의 첫 청크에서 캔버스 크기를 읽는다. webp 가 아니거나 모양이 어긋나면 null.
//
// 청크는 세 종류뿐이다(RIFF 헤더 12바이트 뒤 fourCC 4 + 길이 4 = 20바이트부터가 본문):
//   "VP8 " 손실   본문 3바이트 프레임태그 → 시작코드 9D 01 2A → 14비트 가로·세로
//   "VP8L" 무손실 본문 첫 바이트 0x2F 서명 → 32비트 안에 (가로-1, 세로-1) 각 14비트
//   "VP8X" 확장   플래그 1 + 예약 3 → 24비트 (캔버스가로-1) → 24비트 (캔버스세로-1)
// 알파가 있으면 인코더가 VP8X 를 쓰므로(sharp·Skia 둘 다) VP8X 를 거절할 수는 없다.
// 애니메이션은 VP8X 플래그의 ANIM 비트(0x02)로만 구분된다.
export function readWebpInfo(bytes: Uint8Array): WebpInfo | null {
  if (bytes.length < 30) return null;
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WEBP") return null;

  const chunk = ascii(bytes, 12, 4);
  if (chunk === "VP8 ") {
    // 시작코드가 없으면 VP8 프레임이 아니다(길이만 맞춘 위조).
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return {
      width: u16(bytes, 26) & 0x3fff,
      height: u16(bytes, 28) & 0x3fff,
      animated: false,
    };
  }
  if (chunk === "VP8L") {
    if (bytes[20] !== 0x2f) return null;
    // 21~24 네 바이트에 (가로-1) 14비트 + (세로-1) 14비트가 리틀엔디언으로 붙어 있다.
    const packed = u32(bytes, 21);
    return {
      width: (packed & 0x3fff) + 1,
      height: ((packed >>> 14) & 0x3fff) + 1,
      animated: false,
    };
  }
  if (chunk === "VP8X") {
    return {
      width: u24(bytes, 24) + 1,
      height: u24(bytes, 27) + 1,
      animated: (bytes[20] & 0x02) !== 0,
    };
  }
  return null;
}

// 업로드 직전, 이미 구워진 바이트에 대한 최종 관문. 웹 서버 액션(sharp 결과)과 Edge
// (앱이 보낸 base64 를 푼 결과)가 **같은 함수**를 부른다 — 한쪽에만 있으면 그 경로로
// 규격 밖 이미지가 들어온다.
export function avatarBytesError(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "이미지를 선택해주세요.";
  if (bytes.length > AVATAR_ENCODED_MAX_BYTES) {
    return "이미지가 너무 커요. 다른 사진으로 시도해주세요.";
  }
  const info = readWebpInfo(bytes);
  // 문구는 웹 uploadAvatar 의 sharp 실패 분기와 같은 문장이다 — 사용자에게는 둘 다
  // "이 파일로는 안 된다"는 같은 사실이고, 원인(코덱·크기·애니메이션)을 화면에
  // 늘어놓아 봐야 고를 수 있는 행동이 달라지지 않는다.
  if (!info) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.animated) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.width !== info.height) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.width < 1 || info.width > AVATAR_SIZE) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  // 컨테이너가 "여기까지가 이 파일이다"라고 적어 둔 길이(오프셋 4의 32비트, 자기 앞
  // 8바이트는 빼고 센다)보다 바이트가 더 있으면, 진짜 webp 머리 뒤에 다른 것이 붙어
  // 있는 것이다. 위 검사는 머리 30바이트만 읽으므로 이 줄이 없으면 "머리는 256px webp,
  // 뒤는 임의의 512KB" 인 파일이 공개 버킷에 그대로 올라간다 — contentType 을 서버가
  // image/webp 로 박으니 브라우저가 실행하지는 않지만, 우리 도메인이 아무 파일이나
  // 얹어 두는 자리가 될 이유는 없다.
  // **넘치는 쪽만** 거른다: 인코더는 언제나 정확히 맞춘 값을 쓰고(sharp/libwebp 실측 —
  // VP8·VP8L·VP8X 모두 declared + 8 === 길이), 모자란 쪽은 어차피 못 그리는 이미지인데
  // 거기까지 막으면 인코더 구현 차이로 정상 업로드가 거절되는 방향이 된다.
  if (bytes.length > u32(bytes, 4) + 8) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  return null;
}

// (user_id, avatar_path) 행 → 공개 URL 맵. 지금 부르는 곳은 웹 lib/avatars.ts#fetchAvatarUrls
// 하나지만 core 에 두는 이유는, 앱에 **남의** 아바타를 그리는 자리가 생기면(게시판 — 앱
// 비목표 §5) 같은 행을 다른 경로로 받게 되기 때문이다. **행 → URL 변환이 한 곳**이어야 두
// 경로의 결과가 같다(경로 모양 검증 isValidAvatarPath 를 한쪽만 빠뜨리는 일이 생기지 않게).
export function avatarUrlMap(
  supabaseUrl: string,
  rows: readonly { user_id: string; avatar_path: string | null }[] | null | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows ?? []) {
    const url = avatarPublicUrl(supabaseUrl, row.avatar_path);
    if (url) map.set(row.user_id, url);
  }
  return map;
}
