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

async function run(extract, buf, expectedCount) {
  try {
    const out = await extract(buf, { scale: SCALE, expectedCount });
    return { count: out.length, sets: out.filter((c) => c.groupNumbers).length, error: null };
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
      const oldR = await run(extractOld, buf, p.question_count);
      const newR = await run(extractNew, buf, p.question_count);
      rec = {
        ...rec,
        old: oldR.count, oldErr: oldR.error, oldSets: oldR.sets,
        new: newR.count, newErr: newR.error, newSets: newR.sets,
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
console.log(`\n리포트: ${outPath}`);
process.exit(regressions.length > 0 || setDown.length > 0 ? 1 : 0);
