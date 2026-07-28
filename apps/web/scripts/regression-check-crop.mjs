// 사용법: npm run regression-check-crop -- [--baseline <git-ref>] [--concurrency 8] [--limit N] [--out report.json]
//
// docs/agents/crop-question-images.md가 요구하는 "크롭 로직 수정 시 기존 크롭
// 완료분 전체 회귀 검사"를 자동화한다. 지정한 git ref(기본 HEAD)의
// crop-question-images.mjs를 baseline으로 꺼내, 현재 작업본과 나란히 돌려
// **인식 문항 수가 줄어든 문제지가 0건**인지 확인한다.
//
// 렌더 배율을 낮춰(scale 0.4) 돌리므로 이미지 품질은 보지 않는다 — 개수/에러
// 회귀만 잡는 용도다. 업로드·DB 반영은 일절 하지 않는다.
//
// 주의: "개수 일치 = 성공"이 아니다. 이 검사를 통과해도 세트 병합/크롭 경계 같은
// 시각적 회귀는 못 잡으니, 문서의 나머지 절차(스크린샷 육안 확인)를 반드시 병행할 것.

import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";

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
const baselineRef = typeof args.baseline === "string" ? args.baseline : "HEAD";
const concurrency = args.concurrency ? Number(args.concurrency) : 8;
const limit = args.limit ? Number(args.limit) : undefined;
const outPath = typeof args.out === "string" ? args.out : "crop-regression-report.json";
const SCALE = 0.4;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

// baseline 코드를 git에서 꺼내 임시 파일로 떨군다. 모노레포 전환 전 경로(scripts/)도
// 같이 시도해 오래된 ref와도 비교할 수 있게 한다.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "crop-baseline-"));
const baselinePath = path.join(tmpDir, "baseline-crop.mjs");
let baselineSource = null;
for (const p of ["apps/web/scripts/crop-question-images.mjs", "scripts/crop-question-images.mjs"]) {
  try {
    baselineSource = execFileSync("git", ["show", `${baselineRef}:${p}`], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    console.log(`baseline: ${baselineRef}:${p}`);
    break;
  } catch {
    // 다음 후보 경로로
  }
}
if (!baselineSource) {
  console.error(`${baselineRef}에서 crop-question-images.mjs를 찾지 못했습니다.`);
  process.exit(1);
}
fs.writeFileSync(baselinePath, baselineSource);

// baseline 파일은 node_modules를 찾을 수 있는 곳에 있어야 import된다.
const localBaseline = path.join(import.meta.dirname, "_baseline-crop.generated.mjs");
fs.copyFileSync(baselinePath, localBaseline);

let extractOld;
let extractNew;
try {
  ({ extractQuestionsFromPdf: extractOld } = await import(pathToFileURL(localBaseline).href));
  ({ extractQuestionsFromPdf: extractNew } = await import("./crop-question-images.mjs"));
} finally {
  // import가 끝나면 생성 파일은 지운다 (레포에 남기지 않는다).
  fs.rmSync(localBaseline, { force: true });
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

async function fetchAllRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

console.log("대상 수집 중...");
const papers = await fetchAllRows("exam_papers", "id, title, year, level, file_path, question_count");
const questionRows = await fetchAllRows("questions", "id, paper_id");
const qToPaper = new Map(questionRows.map((r) => [r.id, r.paper_id]));
const imageRows = await fetchAllRows("question_images", "question_id");
const cropped = new Set(imageRows.map((r) => qToPaper.get(r.question_id)).filter(Boolean));

let targets = papers.filter((p) => cropped.has(p.id) && p.file_path);
targets.sort((a, b) => a.id.localeCompare(b.id));
if (limit) targets = targets.slice(0, limit);
console.log(`이미 크롭된 문제지 ${targets.length}개 검사 (scale ${SCALE}, 동시성 ${concurrency})\n`);

// 문항 수만 보면 크롭이 반쪽이어도 통과한다 — 실측 사고: 2026 국회직 8급
// 행정법총론은 25/25로 멀쩡히 통과했지만 좌측 칼럼은 본문 오른쪽이 잘리고 우측
// 칼럼은 구분선과 옆 문제를 물고 있었다. 그래서 이미지 자체의 기하도 같이 잰다:
//   widths      — 한 문제지 안에서 폭이 갈리면 프런트 확대율이 달라져 글씨 크기가
//                 문항마다 달라 보인다(폭 통일이 깨진 신호)
//   maxSkew     — 좌우 잉크 여백 차. 크면 내용이 한쪽으로 치우쳤다는 뜻
//   edgeInkMax  — 이미지 좌우 맨 끝 열에 잉크가 닿은 비율. 높으면 칼럼 경계에서
//                 잘렸거나 옆 칼럼을 물고 있다는 신호
async function measureGeometry(images) {
  let widths = new Set();
  let maxSkew = 0;
  let edgeInkMax = 0;
  for (const buf of images) {
    const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
    const { width, height } = info;
    widths.add(width);
    let l = width;
    let r = -1;
    let edgeL = 0;
    let edgeR = 0;
    for (let y = 0; y < height; y++) {
      const row = y * width;
      for (let x = 0; x < width; x++) {
        if (data[row + x] < 245) {
          if (x < l) l = x;
          if (x > r) r = x;
        }
      }
      if (data[row] < 245) edgeL++;
      if (data[row + width - 1] < 245) edgeR++;
    }
    if (r < 0) continue;
    maxSkew = Math.max(maxSkew, Math.abs(l - (width - 1 - r)));
    edgeInkMax = Math.max(edgeInkMax, edgeL / height, edgeR / height);
  }
  return { widthCount: widths.size, maxSkew, edgeInk: Number(edgeInkMax.toFixed(3)) };
}

async function run(extract, buf, expectedCount, withGeometry) {
  try {
    const out = await extract(buf, { scale: SCALE, expectedCount });
    const base = { count: out.length, sets: out.filter((c) => c.groupNumbers).length, error: null };
    if (!withGeometry) return base;
    const unique = [...new Set(out.map((c) => c.image))];
    return { ...base, geom: await measureGeometry(unique) };
  } catch (err) {
    return { count: null, sets: 0, error: err.message };
  }
}

const results = [];
let done = 0;
let cursor = 0;

async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= targets.length) return;
    const p = targets[i];
    let rec = { id: p.id, title: p.title, year: p.year, qc: p.question_count };
    try {
      const { data: blob, error } = await supabase.storage.from("exam-papers").download(p.file_path);
      if (error) throw new Error(`download: ${error.message}`);
      const buf = Buffer.from(await blob.arrayBuffer());
      const oldR = await run(extractOld, buf, p.question_count, false);
      const newR = await run(extractNew, buf, p.question_count, true);
      rec = {
        ...rec,
        old: oldR.count, oldErr: oldR.error, oldSets: oldR.sets,
        new: newR.count, newErr: newR.error, newSets: newR.sets,
        geom: newR.geom,
      };
    } catch (err) {
      rec = { ...rec, fatal: err.message };
    }
    results.push(rec);
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${targets.length}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

const regressions = results.filter((r) => r.old != null && (r.new == null || r.new < r.old));
const improvements = results.filter((r) => r.new != null && (r.old == null || r.new > r.old));
const setDown = results.filter((r) => (r.newSets ?? 0) < (r.oldSets ?? 0));
const setUp = results.filter((r) => (r.newSets ?? 0) > (r.oldSets ?? 0));
const fatals = results.filter((r) => r.fatal);

fs.writeFileSync(outPath, JSON.stringify({ baselineRef, results }, null, 2));

console.log(`\n===== 결과 (${results.length}개) =====`);
console.log(`회귀(문항 수 감소/새 에러): ${regressions.length}건  ← 0이어야 통과`);
for (const r of regressions) {
  console.log(`  [회귀] ${r.year} ${r.title}: ${r.old} -> ${r.new ?? "에러: " + r.newErr} (qc=${r.qc}) id=${r.id}`);
}
console.log(`개선: ${improvements.length}건`);
for (const r of improvements) {
  console.log(`  [개선] ${r.year} ${r.title}: ${r.old ?? "에러"} -> ${r.new} (qc=${r.qc})`);
}
console.log(`세트 병합 감소: ${setDown.length}건  ← 0이어야 정상 (지문이 문항마다 복제된다는 뜻)`);
for (const r of setDown) console.log(`  [세트감소] ${r.year} ${r.title}: ${r.oldSets} -> ${r.newSets} id=${r.id}`);
console.log(`세트 병합 증가: ${setUp.length}건`);
console.log(`검사 실패: ${fatals.length}건`);

// 개수가 맞아도 이미지가 반쪽일 수 있어 기하도 본다(measureGeometry 주석 참고).
const SKEW_LIMIT_PX = 12; // scale 0.4 기준
const EDGE_INK_LIMIT = 0.05; // 가장자리 열의 5% 넘게 잉크가 닿으면 잘림/침범 의심
const mixedWidth = results.filter((r) => (r.geom?.widthCount ?? 1) > 1);
const skewed = results.filter((r) => (r.geom?.maxSkew ?? 0) > SKEW_LIMIT_PX);
const edgeCut = results.filter((r) => (r.geom?.edgeInk ?? 0) > EDGE_INK_LIMIT);
console.log(`\n--- 이미지 기하 (개수만으로 못 잡는 것들) ---`);
console.log(`문제지 안에서 폭이 갈림: ${mixedWidth.length}건  ← 0이어야 정상`);
for (const r of mixedWidth.slice(0, 10)) console.log(`  ${r.year} ${r.title} (폭 ${r.geom.widthCount}종) id=${r.id}`);
console.log(`좌우 치우침 > ${SKEW_LIMIT_PX}px: ${skewed.length}건`);
for (const r of skewed.slice(0, 10)) console.log(`  ${r.year} ${r.title} (${r.geom.maxSkew}px) id=${r.id}`);
console.log(`가장자리 잉크 > ${EDGE_INK_LIMIT * 100}%(잘림/옆칼럼 침범 의심): ${edgeCut.length}건`);
for (const r of edgeCut.slice(0, 15)) console.log(`  ${r.year} ${r.title} (${(r.geom.edgeInk * 100).toFixed(1)}%) id=${r.id}`);

console.log(`\n리포트: ${outPath}`);
process.exit(regressions.length > 0 || setDown.length > 0 || mixedWidth.length > 0 ? 1 : 0);
