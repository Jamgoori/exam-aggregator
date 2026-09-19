import { BOARD_IMAGE_MAX_PIXELS, BOARD_IMAGE_MAX_WIDTH, boardImageBytesError } from "@gongmoa/core";
import { ImageFormat, rect, Skia, type SkSurface } from "@shopify/react-native-skia";

// 게시판 본문 이미지 굽기 — 아바타(avatar-image.ts)와 같은 결정이다: **앱이 굽고 서버가 검사한다**
// (core board-image.ts 머리말, 설계서 §12-8). 웹은 서버(sharp)가 `resize({ width: 1600,
// withoutEnlargement: true }).webp({ quality: 82 })` 로 굽지만 Deno 에는 sharp 가 없고, 앱에는 CBT
// 필기 레이어로 이미 들어 있는 @shopify/react-native-skia 가 있어 새 네이티브 의존 없이 구울 수 있다.
// Skia 빌드에 WEBP 인코더가 실제로 링크돼 있다는 실측은 avatar-image.ts 머리 주석에 있다(같은
// 바이너리다).
//
// EXIF 회전(웹 sharp 의 `.rotate()` 자리)은 여기서 하지 않는다 — 두 겹으로 이미 보정돼 들어온다:
//   · expo-image-picker 가 base64 를 만들 때 iOS 는 `fixOrientation()`(ios/ImageUtils.swift —
//     "No editing – only remove any EXIF orientation so JavaScript consumers see an upright image"),
//     Android 는 ImageLoader(Glide)로 디코딩한 **비트맵**을 JPEG 로 다시 굽고 EXIF 를 옮길 때
//     TAG_ORIENTATION 을 뺀다(exporters/CompressionImageExporter.kt + ImagePickerUtils.kt
//     copyExifData 의 omittableTags). 즉 픽셀이 이미 바로 서 있고 회전 태그는 없다.
//   · 그래도 태그가 남아 온다면 Skia 디코더가 적용한다 — 동봉 libskia.a 의
//     SkCodecImageGenerator::onGetPixels 가 SkPixmapUtils::Orient 를 부른다(nm 으로 확인).
// 그래서 여기서 또 돌리면 오히려 두 번 돈다.

// 웹 uploadBoardImage 의 sharp `.webp({ quality: 82 })` 와 같은 값. 100 이상을 주면 네이티브 바인딩이
// **무손실(VP8L)** 로 전환해(JsiSkImage.h) 2MB 상한(BOARD_IMAGE_ENCODED_MAX_BYTES)에 금방 닿으므로
// 반드시 100 미만이어야 한다.
const WEBP_QUALITY = 82;

// 웹 uploadBoardImage 의 sharp 실패 분기·core boardImageBytesError 와 같은 문장.
const DECODE_FAILED = "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";

// avatar-image.ts 와 같은 이유로 조용히 끝내지 않는다(실측대로면 닿지 않는 분기).
const ENCODE_FAILED =
  "이 기기에서 사진을 WEBP 로 변환하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.";

export type BakedBoardImage = {
  // EF board-write `{ action: "image", webpBase64 }` 그대로(데이터 URL 접두 없음).
  base64: string;
  // 구워진 바이트 수(보내기 전 검사에 쓴 값).
  bytes: number;
  width: number;
  height: number;
};

// 앨범에서 고른 이미지(base64, JPEG) → 가로 ≤ 1600px webp base64.
//
// **축소만 한다**(웹 withoutEnlargement) — 원본이 1600px 보다 좁으면 크기를 그대로 두고 형식만 webp 로
// 바꾼다. 비율은 유지하고 자르지 않는다(세로는 비율대로 따라간다 — 그래서 서버 검사가 세로 상한이
// 아니라 픽셀 수 상한이다, core BOARD_IMAGE_MAX_PIXELS 주석).
//
// 메모리 순서: 원본(디코딩된 비트맵 — 1200만 화소 RGBA 면 48MB) → CPU 표면(≤1600px 폭) → 스냅샷.
// 원본은 표면에 **그린 직후** 놓는다(decodeAndDraw 의 finally) — 인코딩이 도는 동안까지 들고 있으면
// 원본과 표면이 함께 살아 있는 구간이 그만큼 길어진다. 래스터 표면의 스냅샷은 표면 픽셀을 공유하므로
// (copy-on-write) 스냅샷을 만들어도 두 벌이 되지 않는다.
//
// 동기 함수라 JS 스레드를 잡는다(1200만 화소면 수백 ms). 부르는 쪽은 "올리는 중" 표시를 먼저 그린 뒤
// 한 틱 양보하고 부른다(avatar-field.tsx 와 같은 방식). 실패는 던지고 문구는 그대로 화면에 뿌려도 되는
// 한국어다.
export function bakeBoardImageWebp(sourceBase64: string): BakedBoardImage {
  const { surface, width, height } = decodeAndDraw(sourceBase64);
  try {
    const snapshot = surface.makeImageSnapshot();
    try {
      // 두 번 굽는다(avatar-image.ts 와 같은 이유): 바이트는 보내기 전 검사에, base64 는 본문에.
      const bytes = snapshot.encodeToBytes(ImageFormat.WEBP, WEBP_QUALITY) as Uint8Array | null;
      if (!bytes || bytes.length === 0) throw new Error(ENCODE_FAILED);

      // 서버(EF board-write)가 같은 함수로 최종 검사하지만, 2MB 를 넘는 결과를 굳이 올려보낸 뒤
      // 거절당하면 모바일 데이터만 쓰고 끝난다.
      const invalid = boardImageBytesError(bytes);
      if (invalid) throw new Error(invalid);

      const base64 = snapshot.encodeToBase64(ImageFormat.WEBP, WEBP_QUALITY) as string | null;
      if (!base64) throw new Error(ENCODE_FAILED);

      return { base64, bytes: bytes.length, width, height };
    } finally {
      snapshot.dispose();
    }
  } finally {
    surface.dispose();
  }
}

// 원본을 디코딩해 축소 크기의 CPU 표면에 그리고 표면만 돌려준다. 원본 비트맵은 여기서 놓는다.
function decodeAndDraw(sourceBase64: string): { surface: SkSurface; width: number; height: number } {
  const data = Skia.Data.fromBase64(sourceBase64);
  const image = Skia.Image.MakeImageFromEncoded(data);
  // Skia 가 디코딩하는 형식은 JPEG·PNG·WEBP·GIF·BMP. picker 가 언제나 JPEG 로 다시 내보내므로 HEIC 는
  // 여기 닿지 않고, AVIF(core BOARD_IMAGE_ALLOWED_MIME 에는 있음)만 웹(sharp)은 받고 앱은 이 분기다.
  if (!image) throw new Error(DECODE_FAILED);

  let surface: SkSurface | null = null;
  try {
    const sourceWidth = image.width();
    const sourceHeight = image.height();
    if (sourceWidth < 1 || sourceHeight < 1) throw new Error(DECODE_FAILED);

    const scale = Math.min(1, BOARD_IMAGE_MAX_WIDTH / sourceWidth);
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    // 서버와 같은 면적 상한. 여기서 먼저 막는 이유는 그 크기의 CPU 표면을 만드는 것 자체가 이 기기의
    // 메모리이기 때문이다(1600×6000 RGBA 가 38MB 다 — 그 위는 그리지 않는다).
    if (width * height > BOARD_IMAGE_MAX_PIXELS) throw new Error(DECODE_FAILED);

    const src = rect(0, 0, sourceWidth, sourceHeight);
    const dst = rect(0, 0, width, height);

    // CPU 표면(GPU 컨텍스트가 없는 곳에서 부른다 — MakeOffscreen 이 아니라 Make).
    surface = Skia.Surface.Make(width, height);
    if (!surface) throw new Error(ENCODE_FAILED);

    // Mitchell 큐빅(B=C=1/3) — 큰 사진을 줄이는 자리라 Nearest/Linear 면 계단이 남는다.
    // 같은 크기(축소 없음)일 때도 이 경로로 그린다 — 형식 변환만 하는 셈이고 픽셀은 그대로다.
    surface.getCanvas().drawImageRectCubic(image, src, dst, 1 / 3, 1 / 3);
    surface.flush();
    return { surface, width, height };
  } catch (e) {
    // 그리다 실패하면 표면을 돌려줄 사람이 없다 — 여기서 놓고 다시 던진다.
    surface?.dispose();
    throw e;
  } finally {
    // 앨범 원본은 수십 MB 비트맵일 수 있다. 그린 순간 볼일이 끝나므로 인코딩 전에 바로 놓는다(머리말).
    image.dispose();
  }
}
