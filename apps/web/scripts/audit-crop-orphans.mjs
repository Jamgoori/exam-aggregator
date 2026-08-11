// 사용법:
//   npm run audit-crop-orphans                      # 이미 크롭된 문제지 전수 검사
//   npm run audit-crop-orphans -- --limit 40        # 빠른 스모크
//   node scripts/audit-crop-orphans.mjs --file a.pdf --expected 20   # 로컬 PDF 한 장
//
// "문항 꼬리 소실"을 찾는다 — 한 문항의 내용이 칼럼/페이지 경계를 넘어 다음
// 슬롯(페이지·칼럼) 맨 위로 이어지는데, 크롭은 "마커 → 같은 칼럼의 다음 마커(또는
// 칼럼 끝)"까지만 담기 때문에 넘어간 뒷부분이 **어떤 이미지에도 들어가지 않는**
// 경우다(실측: 선택지 ①②만 보이고 ③④⑤가 통째로 없는 문항).
//
// 이 실패는 기존 검사가 전부 통과한다: 문항 수는 정확히 맞고(마커는 다 찾았다),
// 폭도 같고, 잉크 치우침·가장자리 잉크도 정상이다. 사라진 건 "어느 이미지에도
// 담기지 않은 지면 영역"이라 이미지만 재서는 보이지 않는다. 그래서 이미지가 아니라
// **지면 쪽에서** 검사한다 — 슬롯 맨 위에서 그 슬롯 첫 마커 사이에 남는 텍스트
// 줄(= 앞 문항의 꼬리)을 센다.
//
// 판정은 크롭 스크립트의 `planOverflowTails`를 **그대로 공유한다** — 검사가 따로
// 베껴 쓰면 크롭이 바뀔 때 조용히 어긋난다. 그래서 리포트는 두 갈래다:
//   [병합됨]      — 재크롭하면 이 꼬리가 문항 이미지에 이어붙는다(= 재크롭 대상)
//   [손대지 않음] — 꼬리는 감지했지만 안전장치에 걸려 크롭이 건드리지 않는다
//                   (안내문 세트 소속 / 꼬리가 세 슬롯 이상 / 너무 작음) = 수동 확인
//
// 크롭은 하지 않는다(렌더링 없음). 문서당 텍스트 레이어만 읽으므로 전수 검사가
// 몇 분이면 끝난다. 업로드·DB 쓰기도 일절 하지 않는다.
//
// 한계: 텍스트 조각이 없는 순수 그림(선·도형만 있는 도표)으로만 이루어진 꼬리는
// 못 잡는다. 그림 안 수치/범례가 텍스트로 들어있는 보통의 조판은 잡힌다.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pathToFileURL } from "node:url";

import { buildMarkerPlan, planOverflowTails, splitIntoColumns } from "./crop-question-images.mjs";

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

// 마커 개수만으로 두 전략 중 하나를 고른다. extractQuestionsFromPdf가 크롭까지
// 돌려 고르는 것과 결과가 같다 — 크롭 결과 개수는 정리된 마커 개수와 항상 같기
// 때문이다(세트 병합은 한 이미지를 여러 번호가 공유할 뿐 번호 수는 그대로다).
// 렌더링을 피하려고 여기서만 개수로 대신 고른다.
function countMarkers(pageMarkerData, columnMode, columnSplitX) {
  let n = 0;
  for (const { data } of pageMarkerData) {
    const { left, right } = splitIntoColumns(data.markers, data.pageWidthPt, columnMode, columnSplitX);
    n += columnMode === "single" ? left.length : left.length + right.length;
  }
  return n;
}

async function planFor(pdf, expectedCount) {
  const legacy = await buildMarkerPlan(pdf, false);
  const legacyCount = countMarkers(legacy.pageMarkerData, legacy.columnMode, legacy.columnSplitX);
  if (expectedCount == null || legacyCount === expectedCount) {
    return { ...legacy, count: legacyCount };
  }
  let override;
  try {
    override = await buildMarkerPlan(pdf, true);
  } catch {
    return { ...legacy, count: legacyCount };
  }
  const overrideCount = countMarkers(
    override.pageMarkerData,
    override.columnMode,
    override.columnSplitX,
  );
  if (overrideCount === expectedCount || overrideCount > legacyCount) {
    return { ...override, count: overrideCount };
  }
  return { ...legacy, count: legacyCount };
}

export async function auditPdf(pdfBuffer, { expectedCount } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const { pageMarkerData, columnMode, count } = await planFor(pdf, expectedCount);
  const plans = planOverflowTails(pageMarkerData.map((d) => d.data), columnMode);
  return {
    columnMode,
    markerCount: count,
    // 크롭이 이어붙이는 것(skip=null)과, 감지는 했지만 안전장치에 걸려 손대지 않은
    // 것(skip 사유)을 모두 돌려준다 — 후자가 수동 확인 대상이다.
    merged: plans.filter((p) => !p.skip),
    skipped: plans.filter((p) => p.skip),
  };
}

function describe(plan) {
  const where = plan.tail.map((t) => `${t.pageIdx + 1}쪽 ${t.col}`).join(" + ");
  return `${plan.number}번 꼬리 ${plan.lines}줄(${plan.extentPt}pt) @ ${where}`;
}

async function runLocalFile(args) {
  const buf = fs.readFileSync(args.file);
  const result = await auditPdf(buf, {
    expectedCount: args.expected ? Number(args.expected) : undefined,
  });
  console.log(`${args.file}: ${result.columnMode}, 마커 ${result.markerCount}개`);
  if (result.merged.length === 0 && result.skipped.length === 0) {
    console.log("꼬리 소실 없음");
    return 0;
  }
  for (const plan of result.merged) console.log(`  [병합됨] ${describe(plan)}`);
  for (const plan of result.skipped) console.log(`  [손대지 않음: ${plan.skip}] ${describe(plan)}`);
  return result.skipped.length > 0 ? 1 : 0;
}

async function runAll(args) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const concurrency = args.concurrency ? Number(args.concurrency) : 8;
  const limit = args.limit ? Number(args.limit) : undefined;
  const outPath = typeof args.out === "string" ? args.out : "crop-orphan-report.json";

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
  const papers = await fetchAllRows(
    "exam_papers",
    "id, title, year, level, exam_type, file_path, question_count",
  );
  const questionRows = await fetchAllRows("questions", "id, paper_id");
  const qToPaper = new Map(questionRows.map((r) => [r.id, r.paper_id]));
  const imageRows = await fetchAllRows("question_images", "question_id");
  const croppedPapers = new Set(imageRows.map((r) => qToPaper.get(r.question_id)).filter(Boolean));

  let targets = papers.filter((p) => croppedPapers.has(p.id) && p.file_path);
  targets.sort((a, b) => a.id.localeCompare(b.id));
  if (limit) targets = targets.slice(0, limit);
  console.log(`이미 크롭된 문제지 ${targets.length}개 검사 (동시성 ${concurrency})\n`);

  const results = [];
  let done = 0;
  let cursor = 0;
  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= targets.length) return;
      const p = targets[i];
      try {
        const { data: blob, error } = await supabase.storage.from("exam-papers").download(p.file_path);
        if (error) throw new Error(`download: ${error.message}`);
        const buf = Buffer.from(await blob.arrayBuffer());
        const audit = await auditPdf(buf, { expectedCount: p.question_count });
        results.push({
          id: p.id,
          title: p.title,
          year: p.year,
          level: p.level,
          examType: p.exam_type,
          qc: p.question_count,
          markerCount: audit.markerCount,
          columnMode: audit.columnMode,
          merged: audit.merged,
          skipped: audit.skipped,
        });
      } catch (err) {
        results.push({ id: p.id, title: p.title, year: p.year, fatal: err.message });
      }
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const merged = results.filter((r) => (r.merged?.length ?? 0) > 0);
  const skipped = results.filter((r) => (r.skipped?.length ?? 0) > 0);
  const fatals = results.filter((r) => r.fatal);
  const worstOf = (r) => Math.max(...[...(r.merged ?? []), ...(r.skipped ?? [])].map((p) => p.extentPt));
  merged.sort((a, b) => worstOf(b) - worstOf(a));
  skipped.sort((a, b) => worstOf(b) - worstOf(a));
  fs.writeFileSync(outPath, JSON.stringify({ results }, null, 2));

  console.log(`\n===== 결과 (${results.length}개 중) =====`);
  console.log(`꼬리가 발견돼 이제 이어붙는 문제지: ${merged.length}건  ← 재크롭 대상`);
  for (const r of merged.slice(0, 40)) {
    console.log(`  ${r.year} ${r.title} — ${r.merged.map(describe).join(", ")} id=${r.id}`);
  }
  if (merged.length > 40) console.log(`  ... 나머지 ${merged.length - 40}건은 ${outPath} 참고`);
  console.log(`\n감지했지만 안전장치로 손대지 않음: ${skipped.length}건  ← 수동 확인 대상`);
  for (const r of skipped.slice(0, 20)) {
    console.log(
      `  ${r.year} ${r.title} — ${r.skipped.map((p) => `${describe(p)} [${p.skip}]`).join(", ")} id=${r.id}`,
    );
  }
  console.log(`\n검사 실패: ${fatals.length}건`);
  for (const r of fatals.slice(0, 10)) console.log(`  ${r.year} ${r.title}: ${r.fatal}`);
  console.log(`\n리포트: ${outPath}`);
  return merged.length + skipped.length > 0 ? 1 : 0;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const code = args.file ? await runLocalFile(args) : await runAll(args);
  // 검사 도구라 기본은 종료 코드 0(발견 건수는 로그·리포트로 본다). --strict를
  // 주면 한 건이라도 있을 때 1로 끝난다(CI용).
  process.exit(args.strict ? code : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
