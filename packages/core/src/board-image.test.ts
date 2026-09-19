import { test } from "node:test";
import assert from "node:assert/strict";
import {
  boardImageBytesError,
  boardImageOrigin,
  boardImageUploadError,
  BOARD_IMAGE_BASE64_MAX_CHARS,
  BOARD_IMAGE_ENCODED_MAX_BYTES,
  BOARD_IMAGE_MAX_BYTES,
  BOARD_IMAGE_MAX_PIXELS,
  BOARD_IMAGE_MAX_WIDTH,
} from "./board-image";

// 픽스처는 실제 인코더를 부르지 않고 헤더만 손으로 쌓는다(avatar.test.ts 와 같은 방침) —
// 검사 자체가 헤더 30바이트만 읽는 파서라, 진짜 이미지를 만들면 무엇을 검사했는지가 흐려진다.
// 다만 "진짜 인코더가 그 자리에 그 값을 쓰는가"는 손 픽스처로 못 보므로, 맨 아래 REAL 에 sharp 로
// 만든 실제 파일 몇 개(1×1, 200바이트 미만)를 base64 로 박아 같은 판정을 한 번 더 건다.

function riff(fourCC: string, body: number[], extraTail = 0): Uint8Array {
  const bytes = new Uint8Array(12 + 8 + Math.max(body.length, 10) + extraTail);
  const put = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  put(0, "RIFF");
  put(8, "WEBP");
  put(12, fourCC);
  // RIFF 선언 길이 = 파일 크기 - 8 - 꼬리. 꼬리(extraTail)는 "머리 뒤에 붙인 임의 바이트" 다.
  const riffSize = bytes.length - 8 - extraTail;
  bytes[4] = riffSize & 0xff;
  bytes[5] = (riffSize >> 8) & 0xff;
  bytes[6] = (riffSize >> 16) & 0xff;
  bytes[7] = (riffSize >> 24) & 0xff;
  bytes[16] = body.length & 0xff;
  for (let i = 0; i < body.length; i++) bytes[20 + i] = body[i];
  return bytes;
}

function lossy(width: number, height: number, extraTail = 0): Uint8Array {
  return riff(
    "VP8 ",
    [0, 0, 0, 0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f],
    extraTail,
  );
}

function extended(width: number, height: number, flags: number): Uint8Array {
  const w = width - 1;
  const h = height - 1;
  return riff("VP8X", [
    flags, 0, 0, 0,
    w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff,
    h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff,
  ]);
}

const REJECT = "이미지를 처리할 수 없어요. 다른 파일로 시도해주세요.";

test("정상 1600px webp 는 통과한다", () => {
  assert.equal(boardImageBytesError(lossy(BOARD_IMAGE_MAX_WIDTH, 900)), null);
  // 작은 이미지(웹 sharp 의 withoutEnlargement 결과)도 그대로 통과.
  assert.equal(boardImageBytesError(lossy(320, 240)), null);
});

test("가로 1601px 는 거절한다", () => {
  assert.equal(boardImageBytesError(lossy(BOARD_IMAGE_MAX_WIDTH + 1, 100)), REJECT);
});

test("세로가 긴 스크린샷은 통과한다 — 세로는 자르지 않는다", () => {
  // 폰 화면 여러 장을 이어 붙인 캡처: 1080 × 5000. 세로 고정 상한이었다면 거절됐을 값.
  assert.equal(boardImageBytesError(lossy(1080, 5000)), null);
  // 면적 상한(1600×6000)은 넘지 않는 한 어떤 비율도 받는다.
  assert.equal(boardImageBytesError(lossy(400, 16000)), null);
});

test("픽셀 수 상한을 넘는 캔버스는 거절한다", () => {
  // VP8X 는 24비트 캔버스라 큰 값을 적을 수 있다 — 1600 × 6001.
  assert.ok(1600 * 6001 > BOARD_IMAGE_MAX_PIXELS);
  assert.equal(boardImageBytesError(extended(1600, 6001, 0x00)), REJECT);
  assert.equal(boardImageBytesError(extended(1600, 6000, 0x00)), null);
});

test("애니메이션(ANIM 비트)은 거절한다", () => {
  assert.equal(boardImageBytesError(extended(800, 600, 0x02)), REJECT);
  // 알파 비트(0x10)만 있는 확장 컨테이너는 정상이다 — sharp·Skia 가 알파를 이걸로 쓴다.
  assert.equal(boardImageBytesError(extended(800, 600, 0x10)), null);
});

test("RIFF 선언 길이보다 뒤에 더 붙어 있으면 거절한다", () => {
  assert.equal(boardImageBytesError(lossy(800, 600, 64)), REJECT);
});

test("webp 가 아니면 거절한다", () => {
  assert.equal(boardImageBytesError(new Uint8Array(0)), "이미지를 선택해주세요.");
  const png = new Uint8Array(40);
  [0x89, 0x50, 0x4e, 0x47].forEach((b, i) => (png[i] = b));
  assert.equal(boardImageBytesError(png), REJECT);
  assert.equal(
    boardImageBytesError(new Uint8Array(BOARD_IMAGE_ENCODED_MAX_BYTES + 1)),
    "이미지가 너무 커요. 다른 사진으로 시도해주세요.",
  );
});

test("원본 파일 검사 문구는 웹 uploadBoardImage 와 같다", () => {
  assert.equal(boardImageUploadError(null), "이미지를 선택해주세요.");
  assert.equal(boardImageUploadError({ type: "image/png", size: 0 }), "이미지를 선택해주세요.");
  assert.equal(
    boardImageUploadError({ type: "image/svg+xml", size: 10 }),
    "JPG·PNG·WEBP·GIF 이미지만 올릴 수 있어요.",
  );
  assert.equal(
    boardImageUploadError({ type: "image/jpeg", size: BOARD_IMAGE_MAX_BYTES + 1 }),
    "이미지는 10MB 이하로 올려주세요.",
  );
  assert.equal(boardImageUploadError({ type: "image/jpeg", size: 1000 }), null);
});

test("상한 상수 — base64 는 바이트 상한의 4/3", () => {
  assert.equal(BOARD_IMAGE_BASE64_MAX_CHARS, Math.ceil(BOARD_IMAGE_ENCODED_MAX_BYTES / 3) * 4);
  assert.ok(BOARD_IMAGE_ENCODED_MAX_BYTES < BOARD_IMAGE_MAX_BYTES);
});

test("이미지 URL 접두사는 끝에 / 를 붙이고 URL 의 꼬리 / 는 뗀다", () => {
  assert.equal(
    boardImageOrigin("https://p.supabase.co/"),
    "https://p.supabase.co/storage/v1/object/public/board-images/",
  );
  assert.equal(boardImageOrigin("https://p.supabase.co"), boardImageOrigin("https://p.supabase.co/"));
});

// ── 실제 인코더(libwebp 1.6, sharp 0.35) 산출물 ──────────────────────────────
// 위 픽스처는 손으로 쌓은 헤더라 "진짜 인코더가 그 자리에 그 값을 쓰는가"는 따로 확인해야 한다.
// 아래는 sharp 로 만든 실제 파일을 base64 로 박아 둔 것(전부 200바이트 미만) — 검사가 헤더만 읽으므로
// 1×1 이라도 컨테이너 모양은 큰 파일과 같다. 애니메이션은 VP8X + ANIM/ANMF 청크, 1601px 는 VP8 프레임의
// 14비트 가로 필드에 1601 이 든 파일이다. 웹(sharp)·앱(Skia)이 같은 libwebp 로 굽는다.
const REAL = {
  // 1×1 lossy(VP8) — 통과.
  lossy1x1: "UklGRjgAAABXRUJQVlA4ICwAAACwAQCdASoBAAEAAUAiJaACdLoABdQAAJv6FPtRTsP/w5T/w5T/w5T/gggAAA==",
  // 1×1 lossless(VP8L) — 통과.
  lossless1x1: "UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAdQ5CqUrP+BiOh/AAA=",
  // 1601×1 lossy — 가로 상한 초과.
  wide1601: "UklGRnQAAABXRUJQVlA4IGgAAACwCACdASpBBgEAPmEwlkikIyIhIGgAgAwJaW7hd1lwAAFqcMQ6qk2TEOqpNkxDqqTZMQ6qk2TEOqpNkxDqqTZMQ6qk2TEOqpNkxDqqTEAA7f/XwBT1R//9yAf9dn/67P+5RAAAAAAAAA==",
  // 1×1 두 프레임 애니메이션(VP8X ANIM) — 거절.
  animated: "UklGRsAAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AQBBTk1GRAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggLAAAALABAJ0BKgEAAQABQCIloAJ0ugAF1AAAm/oU+1FOw//DlP/DlP/DlP+CCAAAQU5NRkgAAAAAAAAAAAAAAAAAAABkAAAAVlA4IDAAAADUAQCdASoBAAEAAAAiJaACdLoB+AADsAD+9r4H/kFywuuRr/5Af8gP+QH/8eQAAAA=",
  // 1×1 PNG — webp 가 아니다.
  png1x1: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVQImWPgOpECAAIWATftcnGJAAAAAElFTkSuQmCC",
};
const real = (key: keyof typeof REAL) => new Uint8Array(Buffer.from(REAL[key], "base64"));

test("실제 libwebp 산출물 — 정상 lossy·lossless 는 통과, 1601px·애니메이션·PNG 는 거절", () => {
  assert.equal(boardImageBytesError(real("lossy1x1")), null);
  assert.equal(boardImageBytesError(real("lossless1x1")), null);
  assert.equal(boardImageBytesError(real("wide1601")), REJECT);
  assert.equal(boardImageBytesError(real("animated")), REJECT);
  assert.equal(boardImageBytesError(real("png1x1")), REJECT);
});

test("실제 webp 뒤에 임의 바이트를 붙이면 거절한다 — 1바이트라도", () => {
  const good = real("lossy1x1");
  const tail = (n: number) => {
    const out = new Uint8Array(good.length + n);
    out.set(good);
    out.fill(0x41, good.length);
    return out;
  };
  assert.equal(boardImageBytesError(tail(1)), REJECT);
  assert.equal(boardImageBytesError(tail(64)), REJECT);
  assert.equal(boardImageBytesError(tail(512 * 1024)), REJECT);
});
