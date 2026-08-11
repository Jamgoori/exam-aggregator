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
// 크롭은 하지 않는다(렌더링 없음). 문서당 텍스트 레이어만 읽으므로 전수 검사가
// 몇 분이면 끝난다. 업로드·DB 쓰기도 일절 하지 않는다.
//
// 한계: 텍스트 조각이 없는 순수 그림(선·도형만 있는 도표)으로만 이루어진 꼬리는
// 못 잡는다. 그림 안 수치/범례가 텍스트로 들어있는 보통의 조판은 잡힌다.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { pathToFileURL } from "node:url";

import {
  buildMarkerPlan,
  planCrossPageSets,
  splitIntoColumns,
} from "./crop-question-images.mjs";

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

// 꼬리로 인정할 최소 크기. 한 줄짜리 잔해(경계 계산 오차로 남는 얇은 조각)까지
// 보고하면 노이즈가 커지므로, "줄 두 개 이상" 또는 "세로로 이만큼 이상"만 센다.
const MIN_ORPHAN_LINES = 2;
const DEFAULT_MIN_EXTENT_PT = 24;

// 머리글/꼬리말 판정: 글자 내용이 문서 절반 이상의 페이지에서 되풀이되면 본문이
// 아니다. 좌표(y)로 판정하면 매 페이지 같은 자리에 오는 본문 첫 줄을 머리글로
// 오인한다 — crop-question-images.mjs의 computeHeaderInkBottomByPage와 같은 이유로
// 내용 비교를 쓴다(숫자는 #으로 뭉개 쪽번호도 같이 잡는다).
function normalizeRunningText(text) {
  return text.replace(/\s+/g, "").replace(/\d+/g, "#");
}

function findRunningTextKeys(pageDataList) {
  const pagesByKey = new Map();
  for (let i = 0; i < pageDataList.length; i++) {
    for (const l of pageDataList[i].lines ?? []) {
      const key = normalizeRunningText(l.text ?? "");
      if (!key) continue;
      if (!pagesByKey.has(key)) pagesByKey.set(key, new Set());
      pagesByKey.get(key).add(i);
    }
  }
  const minPages = Math.max(2, Math.ceil(pageDataList.length / 2));
  const keys = new Set();
  for (const [key, pages] of pagesByKey) if (pages.size >= minPages) keys.add(key);
  return keys;
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

export async function auditPdf(pdfBuffer, { expectedCount, minExtentPt = DEFAULT_MIN_EXTENT_PT } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const { pageMarkerData, columnSplitX, columnMode, count } = await planFor(pdf, expectedCount);
  const pageDataList = pageMarkerData.map((d) => d.data);

  const colKeys = columnMode === "single" ? ["L"] : ["L", "R"];
  const slots = [];
  for (let p = 0; p < pageDataList.length; p++) {
    for (const col of colKeys) {
      const d = pageDataList[p];
      const { left, right } = splitIntoColumns(d.markers, d.pageWidthPt, columnMode, columnSplitX);
      slots.push({ pageIdx: p, col, markers: col === "L" ? left : right });
    }
  }

  // 페이지/칼럼을 넘는 공통지문 세트는 두 번째 조각부터 칼럼 맨 위에서 잘라
  // 이어붙이므로, 그 슬롯 맨 위의 잉크는 이미 이미지에 들어가 있다 — 꼬리로
  // 세면 안 된다.
  const covered = new Set();
  for (const plan of planCrossPageSets(pageDataList, columnMode)) {
    for (const s of plan.slots.slice(1)) covered.add(`${s.pageIdx}|${s.col}`);
  }

  const runningKeys = findRunningTextKeys(pageDataList);
  const firstMarkerSlot = slots.findIndex((s) => s.markers.length > 0);

  const findings = [];
  let lastNumber = null;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    const data = pageDataList[slot.pageIdx];
    const marker = slot.markers[0] ?? null; // splitIntoColumns가 y 내림차순 = 맨 위
    const prevNumber = lastNumber;
    if (slot.markers.length > 0) lastNumber = slot.markers[slot.markers.length - 1].number;

    // 문서의 첫 마커보다 앞선 슬롯(표지·과목 안내 등)은 애초에 어떤 문항의
    // 꼬리도 아니다. 첫 마커가 있는 슬롯 자체도 그 위는 문제지 머리(과목명·안내)라
    // 건드리지 않는다.
    if (i <= firstMarkerSlot) continue;
    if (covered.has(`${slot.pageIdx}|${slot.col}`)) continue;

    // 마커 위쪽 경계: 마커가 있으면 그 잉크 윗선, 없으면 슬롯 전체가 후보다.
    let thresholdY = marker ? marker.y + (marker.height ?? 0) : -Infinity;
    // 안내문이 마커보다 위에 있으면 그 안내문부터 아래는 세트/스트립 처리가
    // 담당한다 — 안내문 위쪽만 꼬리로 본다.
    for (const g of data.groups ?? []) {
      if (g.col !== slot.col) continue;
      if (g.y <= thresholdY) continue;
      const gTop = g.y + (g.height ?? 0);
      if (gTop > thresholdY) thresholdY = gTop;
    }

    const orphanLines = (data.lines ?? []).filter(
      (l) =>
        l.col === slot.col &&
        l.y > thresholdY &&
        !runningKeys.has(normalizeRunningText(l.text ?? "")),
    );
    if (orphanLines.length === 0) continue;

    const top = Math.max(...orphanLines.map((l) => l.y + (l.height ?? 0)));
    const bottom = Math.min(...orphanLines.map((l) => l.y));
    const extentPt = Number((top - bottom).toFixed(1));
    if (orphanLines.length < MIN_ORPHAN_LINES && extentPt < minExtentPt) continue;

    findings.push({
      page: slot.pageIdx + 1,
      col: slot.col,
      afterNumber: prevNumber,
      nextNumber: marker?.number ?? null,
      lines: orphanLines.length,
      extentPt,
      sample: orphanLines
        .sort((a, b) => b.y - a.y)
        .slice(0, 3)
        .map((l) => l.text.slice(0, 40)),
    });
  }

  findings.sort((a, b) => b.extentPt - a.extentPt);
  return { columnMode, markerCount: count, findings };
}

async function runLocalFile(args) {
  const buf = fs.readFileSync(args.file);
  const result = await auditPdf(buf, {
    expectedCount: args.expected ? Number(args.expected) : undefined,
    minExtentPt: args["min-extent"] ? Number(args["min-extent"]) : undefined,
  });
  console.log(`${args.file}: ${result.columnMode}, 마커 ${result.markerCount}개`);
  if (result.findings.length === 0) {
    console.log("꼬리 소실 의심 없음");
    return 0;
  }
  for (const f of result.findings) {
    console.log(
      `  ${f.page}쪽 ${f.col}칼럼 맨 위에 ${f.lines}줄(${f.extentPt}pt) 남음` +
        ` — ${f.afterNumber ?? "?"}번의 꼬리로 보임 (다음 마커 ${f.nextNumber ?? "없음"})` +
        `\n    ${f.sample.join(" / ")}`,
    );
  }
  return 1;
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
  const minExtentPt = args["min-extent"] ? Number(args["min-extent"]) : DEFAULT_MIN_EXTENT_PT;

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
        const audit = await auditPdf(buf, { expectedCount: p.question_count, minExtentPt });
        results.push({
          id: p.id,
          title: p.title,
          year: p.year,
          level: p.level,
          examType: p.exam_type,
          qc: p.question_count,
          markerCount: audit.markerCount,
          columnMode: audit.columnMode,
          findings: audit.findings,
        });
      } catch (err) {
        results.push({ id: p.id, title: p.title, year: p.year, fatal: err.message });
      }
      done++;
      if (done % 100 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));

  const hit = results.filter((r) => (r.findings?.length ?? 0) > 0);
  const fatals = results.filter((r) => r.fatal);
  hit.sort(
    (a, b) => Math.max(...b.findings.map((f) => f.extentPt)) - Math.max(...a.findings.map((f) => f.extentPt)),
  );
  fs.writeFileSync(outPath, JSON.stringify({ minExtentPt, results }, null, 2));

  console.log(`\n===== 결과 (${results.length}개 중) =====`);
  console.log(`꼬리 소실 의심 문제지: ${hit.length}건`);
  for (const r of hit.slice(0, 40)) {
    const worst = r.findings.reduce((a, b) => (b.extentPt > a.extentPt ? b : a));
    console.log(
      `  ${r.year} ${r.title} — ${r.findings.length}곳, 최대 ${worst.extentPt}pt` +
        ` (${worst.page}쪽 ${worst.col}, ${worst.afterNumber ?? "?"}번 꼬리) id=${r.id}`,
    );
  }
  if (hit.length > 40) console.log(`  ... 나머지 ${hit.length - 40}건은 ${outPath} 참고`);
  console.log(`검사 실패: ${fatals.length}건`);
  for (const r of fatals.slice(0, 10)) console.log(`  ${r.year} ${r.title}: ${r.fatal}`);
  console.log(`\n리포트: ${outPath}`);
  return hit.length > 0 ? 1 : 0;
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
