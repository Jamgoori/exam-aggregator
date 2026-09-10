// 시행처 마크 원본(각 기관 상징) -> public/exam-types 의 24px 표시용 webp.
//
//   node scripts/build-exam-type-icons.mjs [원본디렉터리]
//
// 원본은 scripts/data/exam-type-icons 에 같이 넣어 뒀다(기관 상징 원본 파일).
// 마크를 추가·교체할 때 그 디렉터리에 넣고 아래 MAP 에 한 줄 더하면 된다.
//
// 원본은 기관마다 형식(svg/webp/png)도 여백도 캔버스 비율도 제각각이라,
// 그대로 카드에 넣으면 마크마다 크기가 들쭉날쭉해진다. 여기서 한 번에 맞춘다:
//   1) 투명 여백을 잘라내고(원본 해상도에서)
//   2) 긴 변 96px(24px 표시의 4배) 로 한 번만 축소하고
//   3) webp 로 굽는다.
// 짝이 되는 이름표는 src/lib/exam-type-icons.ts 의 표에 있다.
import sharp from "sharp";
import { mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] ?? path.join(HERE, "data", "exam-type-icons");
const OUT = path.join(HERE, "..", "public", "exam-types");

const MAP = [
  ["경찰.svg", "police.webp"],
  ["계리직.webp", "post.webp"],
  ["국가직지방직기상직.webp", "government.webp"],
  ["국회.svg", "assembly.webp"],
  // 국방부 마크만 흰 면 + 옅은 회색 윤곽선이라 흰 카드 위에서 형체가 안 잡힌다.
  // 무채색 픽셀만 눌러 윤곽선을 진하게 한다(흰 면과 별의 빨강·노랑은 그대로).
  ["군무원.webp", "military.webp", { darkenGrays: 0.62 }],
  ["법원.svg", "court.webp"],
  // 소방 마크만 배경이 흰색으로 채워진 불투명 이미지라, 가장자리에서 시작하는
  // flood fill 로 "바깥쪽 흰색"만 지운다. 마크 안쪽 흰색은 바깥과 이어져 있지
  // 않으므로 남는다.
  ["소방.png", "fire.webp", { cutWhiteBackground: true }],
  ["해경.svg", "coastguard.webp"],
];

const BOX = 96;

mkdirSync(OUT, { recursive: true });

for (const [src, out, opts] of MAP) {
  let input = path.join(SRC, src);
  if (opts?.cutWhiteBackground) input = await cutWhiteBackground(input);
  if (opts?.darkenGrays) input = await darkenGrays(input, opts.darkenGrays);

  const dest = path.join(OUT, out);
  await sharp(input, { density: 600 })
    .trim({ threshold: 0 })
    .resize(BOX, BOX, {
      fit: "inside",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 90, effort: 6 })
    .toFile(dest);

  const meta = await sharp(dest).metadata();
  console.log(`${out}  ${meta.width}x${meta.height}  ${statSync(dest).size}B`);
}

async function cutWhiteBackground(file) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const isNearWhite = (i) =>
    data[i] > 235 && data[i + 1] > 235 && data[i + 2] > 235;

  const seen = new Uint8Array(W * H);
  const stack = [];
  for (let x = 0; x < W; x++) stack.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) stack.push(y * W, y * W + W - 1);

  while (stack.length) {
    const p = stack.pop();
    if (seen[p] || !isNearWhite(p * C)) continue;
    seen[p] = 1;
    data[p * C + 3] = 0;
    const x = p % W;
    const y = (p - x) / W;
    if (x > 0) stack.push(p - 1);
    if (x < W - 1) stack.push(p + 1);
    if (y > 0) stack.push(p - W);
    if (y < H - 1) stack.push(p + W);
  }

  return sharp(data, { raw: { width: W, height: H, channels: C } })
    .png()
    .toBuffer();
}

async function darkenGrays(file, factor) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += info.channels) {
    const max = Math.max(data[i], data[i + 1], data[i + 2]);
    const min = Math.min(data[i], data[i + 1], data[i + 2]);
    // 채도가 있는 픽셀(색)과 순백은 건드리지 않는다.
    if (max - min > 12 || max > 248) continue;
    data[i] = Math.round(data[i] * factor);
    data[i + 1] = Math.round(data[i + 1] * factor);
    data[i + 2] = Math.round(data[i + 2] * factor);
  }
  return sharp(data, {
    raw: { width: info.width, height: info.height, channels: info.channels },
  })
    .png()
    .toBuffer();
}
