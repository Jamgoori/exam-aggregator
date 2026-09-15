// 앱 아이콘 생성기. `node scripts/generate-icons.mjs` 로 assets/*.png 를 다시 만든다.
//
// 왜 스크립트인가: 아이콘을 바이너리로만 두면 색 하나 바꾸는 데도 디자인 도구가 필요하다.
// 여기서는 모양을 코드로 정의해 두고 PNG 를 뽑는다 — 브랜드 색(theme/colors.ts 의 primary)
// 이 바뀌면 아래 상수만 고쳐 다시 돌리면 된다.
//
// 의존성 없이 도는 이유: sharp·canvas 같은 네이티브 모듈은 환경에 따라 로드가 실패한다.
// PNG 는 zlib(노드 내장)만 있으면 직접 쓸 수 있어서 인코더를 담았다.
//
// 만드는 파일:
//   icon.png                      1024² 전체 배경 포함. iOS 는 투명도를 허용하지 않아 불투명.
//   adaptive-icon.png             1024² 안드로이드 적응형 아이콘의 앞면(배경 투명).
//                                 기기가 원/스퀘어클 등으로 잘라내므로 가운데 66% 안에만 그린다.
//   adaptive-icon-monochrome.png  안드로이드 13+ 테마 아이콘(Material You)용 단색 실루엣.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "assets");

const SIZE = 1024;
// 경계를 부드럽게 하려고 4배로 그린 뒤 줄인다(안티에일리어싱).
const SS = 4;

// 브랜드 색 — 웹 로고·app.json adaptiveIcon.backgroundColor 와 같은 초록(#12b382).
// 아래쪽은 packages/design-tokens 의 blue-600(#0a7d5b, 이름은 blue 지만 값은 초록).
const BLUE = [0x12, 0xb3, 0x82];
const BLUE_DEEP = [0x0a, 0x7d, 0x5b];
const WHITE = [0xff, 0xff, 0xff];

// ── PNG 인코더 (RGBA8) ──────────────────────────────────────────────────────
function crc32(buf) {
  let c;
  const table = crc32.table ?? (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  // 10~12: compression / filter / interlace = 0

  // 각 스캔라인 앞에 필터 바이트(0 = None)를 붙인다.
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const from = y * width * 4;
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, from, from + width * 4);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── 모양 정의 ───────────────────────────────────────────────────────────────
// 점이 도형 안에 있는지만 판정하고, 슈퍼샘플링으로 가장자리를 부드럽게 만든다.

function insideRoundRect(x, y, rect) {
  const { cx, cy, w, h, r, angle = 0 } = rect;
  // 회전한 사각형은 점을 반대로 돌려서 축에 맞춘 사각형 문제로 바꾼다.
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const dx0 = x - cx;
  const dy0 = y - cy;
  const dx = Math.abs(dx0 * cos - dy0 * sin);
  const dy = Math.abs(dx0 * sin + dy0 * cos);
  const hw = w / 2 - r;
  const hh = h / 2 - r;
  if (dx <= hw && dy <= h / 2) return true;
  if (dy <= hh && dx <= w / 2) return true;
  const ex = dx - hw;
  const ey = dy - hh;
  return ex > 0 && ey > 0 && ex * ex + ey * ey <= r * r;
}

// 두 선분으로 이루어진 체크 표시. 선분에서의 거리로 두께를 준다.
function insideCheck(x, y, check) {
  const { points, width } = check;
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i];
    const [bx, by] = points[i + 1];
    const vx = bx - ax;
    const vy = by - ay;
    const len2 = vx * vx + vy * vy;
    let t = ((x - ax) * vx + (y - ay) * vy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + t * vx;
    const py = ay + t * vy;
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    if (d2 <= half * half) return true;
  }
  return false;
}

// 아이콘 도형: 기출문제가 겹겹이 모인 모습(뒤로 밀린 종이 두 장) 위에 극복을 뜻하는 체크.
// 좌표는 1024 기준이고, scale 로 안전영역에 맞춰 줄인다.
function buildShapes(scale, cx0, cy0) {
  const S = (v) => v * scale;
  // 뒤 종이는 왼쪽 위로, 앞 종이는 오른쪽 아래로 밀려 있어 도형 전체의 무게중심이
  // 캔버스 중앙에서 벗어난다. 그만큼 되밀어 실제로 가운데 오게 한다(적응형 아이콘은
  // 가장자리가 잘리므로 중심이 중요하다).
  const cx = cx0 + S(23.5);
  const cy = cy0 + S(19);
  const at = (x, y) => [cx + S(x - 512), cy + S(y - 512)];

  // 뒤쪽 두 장은 살짝 기울여 "여러 장이 쌓인" 느낌만 준다.
  const back2 = { cx: cx + S(-46), cy: cy + S(-30), w: S(430), h: S(540), r: S(46), angle: -0.14 };
  const back1 = { cx: cx + S(-16), cy: cy + S(-14), w: S(430), h: S(540), r: S(46), angle: -0.06 };
  const front = { cx: cx + S(24), cy: cy + S(8), w: S(440), h: S(552), r: S(50), angle: 0 };

  const [c0x, c0y] = at(400, 520);
  const [c1x, c1y] = at(470, 596);
  const [c2x, c2y] = at(624, 424);
  const check = { points: [[c0x, c0y], [c1x, c1y], [c2x, c2y]], width: S(74) };

  return { back2, back1, front, check };
}

// ── 렌더 ────────────────────────────────────────────────────────────────────
// mode: "full"(배경 포함) | "foreground"(배경 투명) | "monochrome"(단색 실루엣)
function render(mode) {
  const W = SIZE * SS;
  const px = Buffer.alloc(SIZE * SIZE * 4);

  // 적응형 아이콘(안드로이드)은 기기가 원·스퀘어클 등으로 잘라내므로 가운데 66%
  // (1024 기준 174~850) 안에 담아야 한다. 그 안을 넉넉히 채워야 런처에서 작아 보이지
  // 않는다. 전체 배경이 있는 아이콘(iOS·스토어)은 사방에 여백을 조금 더 준다.
  const scale = mode === "full" ? 0.98 : 1.1;
  // 도형 좌표는 1024 기준인데 캔버스는 슈퍼샘플링만큼 크므로 SS 를 곱해 맞춘다.
  const shapes = buildShapes(scale * SS, W / 2, W / 2);

  const bgAt = (fy) => {
    const t = fy / W;
    return [
      BLUE[0] + (BLUE_DEEP[0] - BLUE[0]) * t,
      BLUE[1] + (BLUE_DEEP[1] - BLUE[1]) * t,
      BLUE[2] + (BLUE_DEEP[2] - BLUE[2]) * t,
    ];
  };

  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // 미리 알파를 곱해 더한 뒤(premultiplied) 마지막에 되돌린다 — 그래야 반투명
      // 가장자리에서 색이 뜨지 않는다.
      let pr = 0, pg = 0, pb = 0, pa = 0;

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = x * SS + sx + 0.5;
          const fy = y * SS + sy + 0.5;

          const onFront = insideRoundRect(fx, fy, shapes.front);
          const onBack =
            insideRoundRect(fx, fy, shapes.back1) || insideRoundRect(fx, fy, shapes.back2);
          const onCheck = onFront && insideCheck(fx, fy, shapes.check);

          // 이 표본에 얹을 전경색과 불투명도.
          let fg = null;
          let fgA = 0;
          if (mode === "monochrome") {
            // 테마 아이콘은 한 색으로만 그려지므로, 종이 실루엣에서 체크를 파내
            // 형태가 남게 한다.
            if ((onFront || onBack) && !onCheck) {
              fg = WHITE;
              fgA = 1;
            }
          } else if (onFront) {
            fg = onCheck ? BLUE : WHITE;
            fgA = 1;
          } else if (onBack) {
            // 뒤 종이는 흐리게 — 깊이만 준다.
            fg = WHITE;
            fgA = mode === "full" ? 0.42 : 0.5;
          }

          let r, g, b, a;
          if (mode === "full") {
            // 배경이 항상 깔려 있어 결과는 언제나 불투명하다.
            const bg = bgAt(fy);
            a = 1;
            r = fg ? fg[0] * fgA + bg[0] * (1 - fgA) : bg[0];
            g = fg ? fg[1] * fgA + bg[1] * (1 - fgA) : bg[1];
            b = fg ? fg[2] * fgA + bg[2] * (1 - fgA) : bg[2];
          } else {
            a = fgA;
            r = fg ? fg[0] : 0;
            g = fg ? fg[1] : 0;
            b = fg ? fg[2] : 0;
          }

          pr += r * a;
          pg += g * a;
          pb += b * a;
          pa += a;
        }
      }

      const n = SS * SS;
      const outA = pa / n;
      const i = (y * SIZE + x) * 4;
      if (outA <= 0) {
        px[i] = px[i + 1] = px[i + 2] = px[i + 3] = 0;
      } else {
        px[i] = Math.round(Math.min(255, pr / n / outA));
        px[i + 1] = Math.round(Math.min(255, pg / n / outA));
        px[i + 2] = Math.round(Math.min(255, pb / n / outA));
        px[i + 3] = Math.round(outA * 255);
      }
    }
  }

  return encodePng(SIZE, SIZE, px);
}

mkdirSync(OUT_DIR, { recursive: true });
for (const [file, mode] of [
  ["icon.png", "full"],
  ["adaptive-icon.png", "foreground"],
  ["adaptive-icon-monochrome.png", "monochrome"],
]) {
  writeFileSync(join(OUT_DIR, file), render(mode));
  console.log("wrote", file);
}
