// 자유게시판 본문 이미지의 공용 규칙(순수).
//
// 아바타(avatar.ts)와 같은 결정이다 — **앱이 굽고 서버가 검사한다.** 웹은 서버에서 sharp 로
// 가로 1600px webp 를 굽지만 Deno(Edge)에는 sharp 가 없고, WASM 코덱을 Edge 에 넣으면
// 콜드스타트·메모리를 사진 한 장 때문에 요청마다 치른다. 앱에는 CBT 필기 레이어로 이미
// 들어 있는 @shopify/react-native-skia 가 있어 새 네이티브 의존 없이 구울 수 있다(설계서
// §12-8 — Skia 정적 라이브러리에 WEBP 인코더가 링크돼 있음을 확인한 근거는 그 절에 있다).
//
// 서버 검사는 디코딩이 아니라 **헤더 읽기**다(avatar.ts#readWebpInfo 재사용). 웹 서버 액션은
// sharp 결과에, Edge 는 앱이 보낸 base64 를 푼 결과에 **같은 함수**(boardImageBytesError)를
// 댄다 — 한쪽에만 있으면 그 경로로 규격 밖 이미지가 공개 버킷에 들어온다.

import { readWebpInfo } from "./avatar";

// 사용자가 고른 **원본** 파일의 크기 상한. 웹 uploadBoardImage 의 IMAGE_MAX_BYTES 를 옮겨 왔다.
// 구워진 결과의 상한(BOARD_IMAGE_ENCODED_MAX_BYTES)과 별개다.
export const BOARD_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

// 받아주는 원본 형식. SVG 는 뺀다 — 래스터로 구워 저장하니 스크립트가 남지는 않지만,
// 파서(librsvg)가 외부 참조를 따라가는 경로를 애초에 열 이유가 없다. 앱 picker 는 언제나
// JPEG 로 다시 내보내므로 앱에서는 사실상 JPEG 만 닿는다.
export const BOARD_IMAGE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
] as const;

export function isAllowedBoardImageMime(mime: string): boolean {
  return (BOARD_IMAGE_ALLOWED_MIME as readonly string[]).includes(mime);
}

// 본문 이미지의 가로 상한. 원본을 그대로 두면 4000px 짜리 사진이 목록·본문에 그대로
// 실려 나간다(모바일에서 그게 곧 데이터 요금이다). 웹 sharp 는 `resize({ width: 1600,
// withoutEnlargement: true })` — 세로는 비율대로 따라가고 자르지 않는다.
export const BOARD_IMAGE_MAX_WIDTH = 1600;

// 픽셀 수 상한. 웹 sharp 는 세로를 자르지 않으므로 "세로 ≤ N" 으로 못 박으면 실제 사진이
// 거절된다 — 긴 채팅 스크린샷·세로로 이어 붙인 문제지 캡처가 1600×5000 을 넘기도 한다.
// 그래서 세로 대신 **면적**으로 막는다: 가로 상한 1600 에 세로 6000 을 곱한 값. 정상적인
// 사진·스크린샷은 이 안에 들고(1600×6000 은 폰 화면 20장 높이다), 그보다 큰 캔버스는
// 이미지가 아니라 뷰어에 렌더 부하를 주려는 것이다. 디코딩을 하지 않으니 여기서 막는 것은
// 서버가 아니라 **보는 사람의 기기**를 지키는 일이다(sharp 의 limitInputPixels 와 같은 자리).
export const BOARD_IMAGE_MAX_PIXELS = BOARD_IMAGE_MAX_WIDTH * 6000;

// 구워진 결과의 바이트 상한. 1600px 폭 q82 손실 webp 는 보통 100~400KB 다. 무손실(VP8L)로
// 구워지거나 노이즈가 많은 사진이면 몇 배가 되므로 2MB 로 넉넉히 둔다. 이 값이 있어야
// "정상적인 1600px webp" 로 위장한 큰 파일을 공개 버킷에 얹는 경로가 막힌다(버킷 자체의
// 파일 크기 제한은 그보다 헐겁다). 원본 상한 10MB 와 혼동하지 말 것 — 그쪽은 굽기 전이다.
export const BOARD_IMAGE_ENCODED_MAX_BYTES = 2 * 1024 * 1024;

// base64 로 실어 보낼 때의 문자 수 상한. base64 는 3바이트를 4글자로 늘리므로 약 33% 부푼다 —
// 바이트 상한을 그대로 쓰면 정상 크기의 이미지가 거절된다. Edge 는 atob **전에** 이 값으로
// 먼저 거른다(거대한 문자열을 굳이 바이트 배열로 펼치지 않는다 — avatar-upload 와 같다).
export const BOARD_IMAGE_BASE64_MAX_CHARS = Math.ceil(BOARD_IMAGE_ENCODED_MAX_BYTES / 3) * 4;

// 본문에 삽입한 이미지의 공개 URL 접두사. 새니타이저(sanitizeRichText 의 imageOrigins)가
// 이 접두사로 시작하는 이미지만 남긴다 — 임의의 외부 주소를 본문에 남기면 추적 픽셀 자리가
// 된다. 웹(NEXT_PUBLIC_SUPABASE_URL)과 Edge(SUPABASE_URL)가 같은 프로젝트를 가리키므로 같은
// 문자열이 나온다. 끝의 `/` 까지가 접두사다.
export function boardImageOrigin(supabaseUrl: string): string {
  return `${String(supabaseUrl ?? "").replace(/\/$/, "")}/storage/v1/object/public/board-images/`;
}

// 업로드 전 클라이언트에서, 업로드 후 서버에서 같은 문구로 걸러낸다(**원본** 파일 검사).
// 순서는 웹 uploadBoardImage 그대로: 없음 → 형식 → 크기.
export function boardImageUploadError(file: { type: string; size: number } | null): string | null {
  if (!file || file.size === 0) return "이미지를 선택해주세요.";
  if (!isAllowedBoardImageMime(file.type)) return "JPG·PNG·WEBP·GIF 이미지만 올릴 수 있어요.";
  if (file.size > BOARD_IMAGE_MAX_BYTES) {
    return `이미지는 ${BOARD_IMAGE_MAX_BYTES / (1024 * 1024)}MB 이하로 올려주세요.`;
  }
  return null;
}

// 업로드 직전, 이미 구워진 바이트에 대한 최종 관문. 보는 것은 avatarBytesError 와 같은 줄이다:
//   (1) 정말 RIFF....WEBP 인가        — 확장자·MIME 는 클라이언트가 부르는 이름일 뿐이다.
//   (2) 가로 ≤ 1600 · 픽셀 수 ≤ 상한  — 웹 sharp 결과와 같은 규격. 세로는 자르지 않으므로
//                                        고정 상한이 아니라 면적으로 본다(위 주석).
//   (3) 애니메이션이 아닌가            — 웹 sharp 도 첫 프레임만 남긴다(움직이는 본문 이미지는
//                                        글보다 눈에 먼저 들어온다).
//   (4) RIFF 선언 길이보다 바이트가 많지 않은가 — 진짜 webp 머리 뒤에 임의의 2MB 를 붙여
//                                        공개 버킷에 얹는 길을 막는다. 넘치는 쪽만 거른다
//                                        (avatarBytesError 의 같은 줄에 이유가 있다).
// 문구는 웹 uploadBoardImage 의 sharp 실패 분기와 같은 문장이다 — 사용자에게는 전부
// "이 파일로는 안 된다"는 같은 사실이고, 원인을 늘어놓아 봐야 고를 행동이 달라지지 않는다.
export function boardImageBytesError(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "이미지를 선택해주세요.";
  if (bytes.length > BOARD_IMAGE_ENCODED_MAX_BYTES) {
    return "이미지가 너무 커요. 다른 사진으로 시도해주세요.";
  }
  const info = readWebpInfo(bytes);
  if (!info) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.animated) return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  if (info.width < 1 || info.height < 1 || info.width > BOARD_IMAGE_MAX_WIDTH) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  if (info.width * info.height > BOARD_IMAGE_MAX_PIXELS) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  if (bytes.length > riffDeclaredLength(bytes) + 8) {
    return "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";
  }
  return null;
}

// 컨테이너가 "여기까지가 이 파일이다"라고 적어 둔 길이(오프셋 4의 32비트 리틀엔디언, 자기 앞
// 8바이트는 빼고 센다).
function riffDeclaredLength(bytes: Uint8Array): number {
  return (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;
}
