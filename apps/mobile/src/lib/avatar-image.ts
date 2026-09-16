import { AVATAR_SIZE, avatarBytesError } from "@gongmoa/core";
import { ImageFormat, rect, Skia } from "@shopify/react-native-skia";

// 프로필 사진 굽기 — **앱이 굽고 서버가 검사한다**(core avatar.ts "구워진 WEBP 검사",
// supabase/functions/avatar-upload 머리말). 웹은 서버에서 sharp 로 256px webp 를 굽지만
// Deno 에는 sharp 가 없고, WASM 코덱을 Edge 에 얹으면 콜드스타트·메모리를 아바타 하나
// 때문에 요청마다 치른다. 그래서 굽는 쪽이 앱이다.
//
// 도구는 **이미 들어 있는** @shopify/react-native-skia 다(CBT 필기 레이어가 쓰는 그것).
// expo-image-manipulator 같은 새 네이티브 의존을 넣으면 OTA 로 못 나가고 APK 재빌드가
// 강제된다 — Phase 3·4 가 JS 전용으로 유지돼 온 이유다.
//
// ── Skia 빌드에 WEBP 인코더가 들어 있는가(실측, 2026-09-16) ──────────────────
// SkImage.encodeToBytes 의 주석이 "Skia must be built with SK_ENCODE_* to encode" 라고
// 말하듯, 타입이 ImageFormat.WEBP 를 내보내는 것과 실제 바이너리에 인코더가 있는 것은
// 별개다. 그래서 동봉된 정적 라이브러리를 직접 확인했다(react-native-skia 2.6.2):
//   libs/android/{arm64-v8a,armeabi-v7a,x86,x86_64}/libskia.a — `webp_encode.SkWebpEncoderImpl.o`
//   libs/ios/libskia.xcframework/{ios-arm64_arm64e, …-simulator}/libskia.a — 같은 오브젝트
//   두 곳 모두 `SkWebpEncoder::Encode(GrDirectContext*, SkImage const*, Options const&)` 가
//   정의(T) 로 들어 있고, libwebp 인코더 오브젝트(webp_enc·vp8l_enc·picture_enc…)도 함께 있다.
// "인코더 없음" 판을 링크했다면 같은 심벌이 nullptr 만 돌려주는 스텁이었을 것이다 — 그건
// 아니다. 즉 WEBP 로 구울 수 있다.
//
// 그래도 **런타임에 결과가 비었는지 확인한다**(아래 EncodeFailed). 네이티브 바인딩은
// 인코딩 실패 시 null 을 돌려주는데 타입은 Uint8Array 라 조용히 지나가기 쉽고, 조용히
// 다른 형식(PNG 등)을 올리면 core isValidAvatarPath 가 `.webp` 만 허용해 서버가 거절한다.
// 만약 언젠가 정말 WEBP 인코딩이 불가능해지면 형식을 바꾸는 것이지 여기만 고칠 일이
// 아니다 — packages/core/src/avatar.ts 의 AVATAR_PATH_RE·readWebpInfo·avatarBytesError 와
// packages/core/src/rules/avatar.ts 의 경로 확장자·contentType 까지 **네 곳을 함께** 고쳐야
// 한다(PNG 폴백 절차는 그 파일들의 주석 참고).

// 웹 uploadAvatar 의 sharp `.webp({ quality: 82 })` 와 같은 값. 100 이상을 주면 네이티브
// 바인딩이 **무손실(VP8L)** 로 전환하므로(JsiSkImage.h) 82 는 반드시 100 미만이어야 한다.
const WEBP_QUALITY = 82;

// 웹 uploadAvatar 의 sharp 실패 분기와 같은 문장. 원인(코덱·크기·애니메이션)을 늘어놓아야
// 사용자가 고를 수 있는 행동이 달라지지 않는다.
const DECODE_FAILED = "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";

// 위 실측대로면 닿지 않는 분기다. 그래도 조용히 끝내지 않는 이유: 여기서 실패하면
// "왜 안 되는지"를 아는 사람이 아무도 없게 된다(서버는 요청 자체를 못 받는다).
const ENCODE_FAILED =
  "이 기기에서 사진을 WEBP 로 변환하지 못했어요. 앱을 최신 버전으로 업데이트한 뒤 다시 시도해주세요.";

export type BakedAvatar = {
  // EF avatar-upload 의 webpBase64 그대로(데이터 URL 접두 없음).
  base64: string;
  // 구워진 바이트 수. 화면 표시용이 아니라 보내기 전 검사(avatarBytesError)에 쓴 값이다.
  bytes: number;
};

// 앨범에서 고른 이미지(base64, JPEG) → 256×256 정사각 webp base64.
//
// 웹 sharp 는 `fit:"cover", position:"attention"`(내용을 보고 고르는 스마트 크롭)인데
// Skia 에는 그에 해당하는 것이 없다. 대신 **가운데 정사각형**을 잘라 넣는다 — 앱은 고를 때
// expo-image-picker 의 크롭 UI(allowsEditing)를 먼저 거치므로 어디를 남길지는 이미 사용자가
// 정한 뒤다. 결과 규격(정사각 256px webp)은 웹과 같고, 그게 서버가 검사하는 전부다.
//
// 실패는 던진다. 문구는 그대로 화면에 뿌려도 되는 한국어다.
export function bakeAvatarWebp(sourceBase64: string): BakedAvatar {
  const data = Skia.Data.fromBase64(sourceBase64);
  const image = Skia.Image.MakeImageFromEncoded(data);
  // Skia 가 디코딩할 수 있는 형식은 JPEG·PNG·WEBP·GIF·BMP 다(동봉 libskia 의 코덱 목록).
  // HEIC 는 없지만 expo-image-picker 가 base64 를 언제나 JPEG 로 다시 내보내므로
  // (iOS ImageUtils.swift / Android CompressionImageExporter) 여기 닿지 않는다. AVIF 는
  // core AVATAR_ALLOWED_MIME 에는 있으나 Skia 코덱이 없어 이 분기로 떨어진다 — 웹(sharp)이
  // 받아주는 것을 앱이 못 받는 유일한 형식이고, 문구는 sharp 실패와 같으므로 사용자가 겪는
  // 일은 "다른 사진을 고른다" 로 같다.
  if (!image) throw new Error(DECODE_FAILED);

  try {
    const width = image.width();
    const height = image.height();
    if (width < 1 || height < 1) throw new Error(DECODE_FAILED);

    // 가운데 정사각형(cover). 원본이 256px 보다 작아도 확대해 채운다 — sharp 도 기본이
    // 확대이고(withoutEnlargement 없음), 결과가 언제나 256×256 이어야 서버 검사(정사각형 +
    // 한 변 ≤ AVATAR_SIZE)를 통과한다.
    const side = Math.min(width, height);
    const src = rect((width - side) / 2, (height - side) / 2, side, side);
    const dst = rect(0, 0, AVATAR_SIZE, AVATAR_SIZE);

    // CPU 표면. GPU 컨텍스트가 없는 곳(화면 밖)에서 부르므로 MakeOffscreen 이 아니라 Make.
    const surface = Skia.Surface.Make(AVATAR_SIZE, AVATAR_SIZE);
    if (!surface) throw new Error(ENCODE_FAILED);

    try {
      // Mitchell 큐빅(B=C=1/3) — 큰 사진을 256px 로 줄이는 자리라 Nearest/Linear 면 계단이
      // 그대로 남는다. sharp 의 기본 축소 커널(Lanczos3)과 같지는 않지만 같은 급이다.
      surface.getCanvas().drawImageRectCubic(image, src, dst, 1 / 3, 1 / 3);
      surface.flush();

      const snapshot = surface.makeImageSnapshot();
      try {
        // 두 번 굽는다: 바이트는 **보내기 전 검사**(서버와 같은 함수·같은 문구)에, base64 는
        // 본문에 쓴다. RN 에는 믿을 수 있는 전역 base64 인코더가 없어서 Uint8Array →
        // base64 를 손으로 들고 다녀야 하는데, 256px 이미지를 두 번 인코딩하는 비용(수 ms)이
        // 그 코드를 유지하는 비용보다 싸다. 같은 이미지·같은 옵션이라 두 결과는 같은 바이트다.
        const bytes = snapshot.encodeToBytes(ImageFormat.WEBP, WEBP_QUALITY) as Uint8Array | null;
        if (!bytes || bytes.length === 0) throw new Error(ENCODE_FAILED);

        // 서버가 최종 관문이지만(EF 가 같은 avatarBytesError 를 부른다), 규격 밖 이미지를
        // 굳이 올려보낸 뒤 거절당하면 모바일 데이터만 쓰고 끝난다.
        const invalid = avatarBytesError(bytes);
        if (invalid) throw new Error(invalid);

        const base64 = snapshot.encodeToBase64(ImageFormat.WEBP, WEBP_QUALITY) as string | null;
        if (!base64) throw new Error(ENCODE_FAILED);

        return { base64, bytes: bytes.length };
      } finally {
        snapshot.dispose();
      }
    } finally {
      surface.dispose();
    }
  } finally {
    // 원본은 앨범 사진이라 수십 MB 짜리 비트맵일 수 있다. GC 를 기다리지 않고 바로 놓는다.
    image.dispose();
  }
}
