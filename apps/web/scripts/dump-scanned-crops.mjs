// 스캔본 한 회차를 크롭해서 **업로드 없이 디스크에 저장**한다 — 눈으로 보기 위한 것.
//
//   node --env-file=.env.local scripts/dump-scanned-crops.mjs --round 78 --out <dir>
//
// 왜 따로 두나: docs/agents/crop-question-images.md 의 금지선이 "개수만 보고 끝내지
// 말고 이미지를 눈으로 보라"인데, 스캔본 경로에는 그럴 수단이 없었다
// (crop-scanned-questions.mjs 의 --dry-run 은 개수·대조 수치만 찍는다). 실제로 그
// 사각지대에서 74회가 **문항 절반의 발문을 잃은 채** 올라간 적이 있다.
//
// 문항별 PNG 와 함께 "발문부터 마지막 선지까지" 이어 붙인 병합본도 만든다 — 상단
// 경계를 고치면 하단이 깨질 수 있어서 한쪽만 보면 안 된다(2026-09-12 실측).

import { createClient } from "@supabase/supabase-js";
import { createWorker, PSM } from "tesseract.js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { extractQuestionsFromPdf } from "./crop-question-images.mjs";
import { buildOcrTextLayer } from "./lib/ocr-text-layer.mjs";

const pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const round = Number(args.round);
const outDir = path.join(String(args.out ?? "."), `${round}회`);
fs.mkdirSync(outDir, { recursive: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const { data: examTypes } = await supabase.from("exam_types").select("id, name");
const kheId = examTypes.find((t) => t.name === "한능검").id;
const { data: papers } = await supabase
  .from("exam_papers")
  .select("id, title, round, file_path, question_count")
  .eq("exam_type_id", kheId)
  .eq("round", round);
const paper = papers[0];

const { data: blob } = await supabase.storage.from("exam-papers").download(paper.file_path);
const pdfBuffer = Buffer.from(await blob.arrayBuffer());
const pdfjs = await pdfjsPromise;
const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

const worker = await createWorker("kor+eng", 1, { cachePath: ".ocr-cache" });
const sweepWorker = await createWorker("eng", 1, { cachePath: ".ocr-cache" });
await sweepWorker.setParameters({
  tessedit_char_whitelist: "0123456789.",
  tessedit_pageseg_mode: PSM.SPARSE_TEXT,
});
const digitWorker = await createWorker("eng", 1, { cachePath: ".ocr-cache" });
await digitWorker.setParameters({
  tessedit_char_whitelist: "0123456789.",
  tessedit_pageseg_mode: PSM.SINGLE_WORD,
});

let rescued = 0;
let deduped = 0;
let demoted = 0;
const textLayer = await buildOcrTextLayer(pdf, worker, {
  digitWorker,
  sweepWorker,
  expectedMarkerCount: paper.question_count ?? undefined,
  onRescue: (n, d, x) => {
    rescued = n;
    deduped = d ?? 0;
    demoted = x ?? 0;
  },
});
await worker.terminate();
await sweepWorker.terminate();
await digitWorker.terminate();

const cropped = await extractQuestionsFromPdf(pdfBuffer, {
  scale: 3,
  expectedCount: paper.question_count,
  textLayer,
  footerDetection: false, // crop-scanned-questions.mjs 와 같은 설정
});
console.log(
  `${paper.title}: ${cropped.length}/${paper.question_count}개 (되살린 마커 ${rescued}개, 중복 바로잡음 ${deduped}개, 순서 어긋나 내림 ${demoted}개)`,
);

for (const c of cropped) {
  const name = `${String(c.number).padStart(2, "0")}${c.groupNumbers ? `-세트(${c.groupNumbers.join(",")})` : ""}.png`;
  fs.writeFileSync(path.join(outDir, name), c.image);
}

// 눈으로 훑기 좋게 앞쪽 몇 개를 세로로 이어 붙인 병합본도 만든다.
async function sheet(numbers, file) {
  const picked = cropped.filter((c) => numbers.includes(c.number));
  if (picked.length === 0) return;
  const W = 760;
  const parts = [];
  let y = 0;
  for (const c of picked) {
    const img = await sharp(c.image).resize({ width: W - 20, withoutEnlargement: true }).png().toBuffer();
    const meta = await sharp(img).metadata();
    parts.push({ input: img, top: y + 10, left: 10 });
    y += meta.height + 20;
  }
  await sharp({ create: { width: W, height: y, channels: 3, background: "#dddddd" } })
    .composite(parts)
    .png()
    .toFile(path.join(outDir, file));
}
// 전 문항을 다섯 개씩 병합해 둔다 — 눈으로 전수 확인할 때 한 장에 다섯 문항.
for (let start = 1; start <= paper.question_count; start += 5) {
  const numbers = Array.from({ length: 5 }, (_, i) => start + i).filter((n) => n <= paper.question_count);
  await sheet(numbers, `병합-${String(start).padStart(2, "0")}-${String(numbers[numbers.length - 1]).padStart(2, "0")}.png`);
}
console.log(outDir);
