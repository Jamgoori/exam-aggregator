import { test } from "node:test";
import assert from "node:assert/strict";
import {
  avatarBytesError,
  avatarInitial,
  avatarPublicUrl,
  avatarUploadError,
  avatarUrlMap,
  readWebpInfo,
  AVATAR_BASE64_MAX_CHARS,
  AVATAR_ENCODED_MAX_BYTES,
  AVATAR_MAX_BYTES,
  AVATAR_SIZE,
} from "./avatar";

test("업로드 검증: 형식과 크기", () => {
  assert.equal(avatarUploadError({ type: "image/jpeg", size: 1000 }), null);
  assert.match(
    avatarUploadError({ type: "application/pdf", size: 1000 }) ?? "",
    /이미지만/,
  );
  assert.match(
    avatarUploadError({ type: "image/png", size: AVATAR_MAX_BYTES + 1 }) ?? "",
    /5MB/,
  );
  assert.match(avatarUploadError({ type: "image/png", size: 0 }) ?? "", /선택/);
});

test("아바타 글자는 코드포인트 단위로 자른다", () => {
  assert.equal(avatarInitial("공모아"), "공");
  assert.equal(avatarInitial("  띄어쓰기"), "띄");
  // 이모지가 반으로 잘리면 깨진 글자가 그려진다.
  assert.equal(avatarInitial("🎓학생"), "🎓");
  assert.equal(avatarInitial(""), "회");
});

test("공개 URL", () => {
  assert.equal(
    avatarPublicUrl("https://p.supabase.co/", "u1/a.webp"),
    "https://p.supabase.co/storage/v1/object/public/avatars/u1/a.webp",
  );
  assert.equal(avatarPublicUrl("https://p.supabase.co", null), null);
  // user_metadata 는 사용자가 직접 고칠 수 있으므로 서버가 만든 모양이 아니면 버린다.
  assert.equal(avatarPublicUrl("https://p.supabase.co", "../exam-papers/2024/x.pdf"), null);
  assert.equal(avatarPublicUrl("https://p.supabase.co", "u1/a.webp?x=1"), null);
  assert.equal(avatarPublicUrl("https://p.supabase.co", "u1/a.png"), null);
});

// ── 구워진 WEBP 검사 ────────────────────────────────────────────────────────
// 테스트 픽스처는 실제 인코더를 부르지 않고 헤더만 손으로 쌓는다 — 검사 자체가
// 헤더 30바이트만 읽는 파서라, 진짜 이미지를 만들면 오히려 무엇을 검사했는지가 흐려진다.

function riff(fourCC: string, body: number[]): Uint8Array {
  const bytes = new Uint8Array(12 + 8 + Math.max(body.length, 10));
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  put(8, "WEBP");
  put(12, fourCC);
  // 오프셋 4의 RIFF 길이 = 파일 크기 - 8. 인코더가 언제나 정확히 맞추는 값이라
  // (sharp/libwebp 실측) 픽스처도 맞춰 둔다 — avatarBytesError 가 "선언보다 뒤에 더
  // 붙어 있는가"를 이 값으로 본다.
  const riffSize = bytes.length - 8;
  bytes[4] = riffSize & 0xff;
  bytes[5] = (riffSize >> 8) & 0xff;
  bytes[6] = (riffSize >> 16) & 0xff;
  bytes[7] = (riffSize >> 24) & 0xff;
  bytes[16] = body.length & 0xff;
  for (let i = 0; i < body.length; i++) bytes[20 + i] = body[i];
  return bytes;
}

function lossy(width: number, height: number): Uint8Array {
  return riff("VP8 ", [
    0, 0, 0, 0x9d, 0x01, 0x2a,
    width & 0xff, (width >> 8) & 0x3f,
    height & 0xff, (height >> 8) & 0x3f,
  ]);
}

function lossless(width: number, height: number): Uint8Array {
  const packed = (width - 1) | ((height - 1) << 14);
  return riff("VP8L", [
    0x2f,
    packed & 0xff, (packed >>> 8) & 0xff, (packed >>> 16) & 0xff, (packed >>> 24) & 0xff,
  ]);
}

function extended(width: number, height: number, animated: boolean): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8X", [
    animated ? 0x02 : 0x10, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

test("WEBP 헤더에서 캔버스 크기를 읽는다(손실·무손실·확장)", () => {
  assert.deepEqual(readWebpInfo(lossy(256, 256)), { width: 256, height: 256, animated: false });
  assert.deepEqual(readWebpInfo(lossless(256, 256)), { width: 256, height: 256, animated: false });
  // 알파가 있으면 인코더가 VP8X 를 쓴다 — 거절하면 안 되는 모양.
  assert.deepEqual(readWebpInfo(extended(256, 256, false)), {
    width: 256,
    height: 256,
    animated: false,
  });
  assert.equal(readWebpInfo(extended(256, 256, true))?.animated, true);
});

test("WEBP 가 아니면 null — 확장자·MIME 이 아니라 바이트로 판정한다", () => {
  assert.equal(readWebpInfo(new Uint8Array(30)), null);
  // PNG 시그니처를 .webp 로 부른 경우.
  const png = new Uint8Array(30);
  png.set([0x89, 0x50, 0x4e, 0x47], 0);
  assert.equal(readWebpInfo(png), null);
  // RIFF/WEBP 는 맞는데 VP8 시작코드(9D 01 2A)가 없다 = 길이만 맞춘 위조.
  const forged = lossy(256, 256);
  forged[23] = 0;
  assert.equal(readWebpInfo(forged), null);
  // 헤더가 다 들어오기도 전에 잘린 바이트.
  assert.equal(readWebpInfo(lossy(256, 256).slice(0, 20)), null);
});

test("아바타 바이트 검증: 정사각형 256px 이하 정지 webp 만 통과", () => {
  assert.equal(avatarBytesError(lossy(AVATAR_SIZE, AVATAR_SIZE)), null);
  assert.equal(avatarBytesError(lossy(120, 120)), null);
  assert.match(avatarBytesError(new Uint8Array(0)) ?? "", /선택/);
  // 한 변이 AVATAR_SIZE 를 넘으면 앱이 굽지 않고 원본을 보낸 것이다.
  assert.match(avatarBytesError(lossy(AVATAR_SIZE + 1, AVATAR_SIZE)) ?? "", /처리할 수 없어요/);
  assert.match(avatarBytesError(lossy(256, 128)) ?? "", /처리할 수 없어요/);
  assert.match(avatarBytesError(extended(256, 256, true)) ?? "", /처리할 수 없어요/);
  assert.match(avatarBytesError(new Uint8Array(40)) ?? "", /처리할 수 없어요/);
});

test("정상 webp 뒤에 다른 것을 붙여 보내면 거절한다", () => {
  // 머리 30바이트만 읽는 검사라, RIFF 가 선언한 길이 밖의 데이터를 보지 않으면
  // "머리는 256px webp, 뒤는 임의의 바이트" 인 파일이 공개 버킷에 그대로 올라간다.
  const head = lossy(256, 256);
  const stuffed = new Uint8Array(head.length + 4096);
  stuffed.set(head, 0);
  stuffed.fill(0x41, head.length); // 'A' — HTML·스크립트 무엇이든 될 수 있는 자리
  assert.equal(avatarBytesError(head), null);
  assert.match(avatarBytesError(stuffed) ?? "", /처리할 수 없어요/);
});

test("구워진 결과의 바이트 상한은 원본 5MB 와 별개다", () => {
  assert.ok(AVATAR_ENCODED_MAX_BYTES < AVATAR_MAX_BYTES);
  const big = new Uint8Array(AVATAR_ENCODED_MAX_BYTES + 1);
  big.set(lossy(256, 256), 0);
  assert.match(avatarBytesError(big) ?? "", /너무 커요/);
  // base64 는 33% 부푼다 — 문자 수 상한이 바이트 상한보다 작으면 정상 이미지가 거절된다.
  assert.ok(AVATAR_BASE64_MAX_CHARS >= Math.ceil(AVATAR_ENCODED_MAX_BYTES / 3) * 4);
});

test("행 → 공개 URL 맵은 웹·앱이 같은 변환을 쓴다", () => {
  const map = avatarUrlMap("https://p.supabase.co", [
    { user_id: "u1", avatar_path: "u1/a.webp" },
    { user_id: "u2", avatar_path: null },
    // 서버가 만든 모양이 아니면 버린다(isValidAvatarPath).
    { user_id: "u3", avatar_path: "../exam-papers/2024/x.pdf" },
  ]);
  assert.equal(map.get("u1"), "https://p.supabase.co/storage/v1/object/public/avatars/u1/a.webp");
  assert.equal(map.has("u2"), false);
  assert.equal(map.has("u3"), false);
  assert.equal(avatarUrlMap("https://p.supabase.co", null).size, 0);
});
