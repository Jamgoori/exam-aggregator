// 사용법:
//   npm run split-by-toc -- --file "경로.pdf" --out uploads/incoming [--dry]
//   npm run split-by-toc -- --dir "src/testpaper/2024 경찰 간부후보" --out uploads/incoming/2024 [--dry]
//
// 경찰간부후보처럼 표지 1페이지에 목차가 통째로 박혀 있는 통합본 PDF를 과목별로
// 자른다. 목차 줄이 "【형 사 법】 (공통) ······ 1" 형태라 과목명과 시작 쪽번호를
// 그대로 읽을 수 있고, 본문 각 페이지 머리의 "- 3 -" 쪽번호로 쪽번호→PDF 페이지
// 대응표를 만들어 자르기 때문에 사람이 페이지를 세지 않아도 된다.
//
// split-combined-pdf.mjs(사람이 boundaries 직접 지정) / split-by-subject-header.mjs
// (페이지 머리글에 과목명이 매 쪽 박힌 국회직용)로는 처리가 안 되는 조판이다 —
// 경찰간부 통합본은 과목 첫 쪽에만 과목명이 있고, 그마저 없는 연도(2021 등)도 있다.
//
// 자른 결과는 "과목명.pdf"로 저장되어 scripts/bulk-upload.mjs가 그대로 집어간다.
// --dry로 먼저 돌려 과목/페이지 범위/경고를 확인할 것.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { safeOutPath } from "./lib/safe-filename.mjs";
import path from "node:path";

// "【형 사 법】 (공통) ·········· 1" — 과목명 안의 공백은 자간이라 제거한다.
const TOC_ENTRY_RE = /【\s*([^】]+?)\s*】\s*\(([^)]*)\)\s*([·․‧∙・.…\s]*)(\d+)/g;
// 본문 페이지 머리의 쪽번호. "- 3 -" 형태.
const PAGE_NUM_RE = /^\s*-\s*(\d+)\s*-/;
// 과목 첫 쪽 머리글. "- 1 - 2 교 시 정 보 보 호 론 사 이 버 1. ..." 형태로,
// 과목명이 박혀 있는 연도(2018~2020, 2022~2026)에서는 목차 쪽번호보다 이쪽이
// 정확하다 (실측: 2023 사이버 통합본은 목차의 "20"이 "0"으로 추출됨).
const BODY_HEADER_RE = /^\s*-\s*\d+\s*-\s*\d\s*교\s*시\s+(.{2,30}?)\s*(?=(?:\d+\s*[.。])|※)/;
// 과목 첫 쪽이면 1번 문제가 있어야 한다("1." 또는 "문 1.").
const FIRST_QUESTION_RE = /(?<!\d)(?:문\s*)?1\s*[.。](?!\d)/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      if (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        args[key] = argv[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

async function getPageTexts(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    texts.push(
      tc.items
        .map((it) => it.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim(),
    );
  }
  return texts;
}

function parseToc(coverText) {
  const entries = [];
  for (const m of coverText.matchAll(TOC_ENTRY_RE)) {
    entries.push({
      subject: m[1].replace(/\s+/g, ""),
      note: m[2].replace(/\s+/g, ""),
      startPrinted: Number(m[4]),
    });
  }
  return entries;
}

// 쪽번호 → PDF 페이지(1-based). 같은 쪽번호가 여러 번 나오면 처음 것을 쓴다.
function buildPrintedPageMap(texts) {
  const map = new Map();
  for (let i = 0; i < texts.length; i++) {
    const m = texts[i].match(PAGE_NUM_RE);
    if (!m) continue;
    const printed = Number(m[1]);
    if (!map.has(printed)) map.set(printed, i + 1);
  }
  return map;
}

async function analyze(filePath) {
  const buffer = await readFile(filePath);
  const texts = await getPageTexts(buffer);
  const entries = parseToc(texts[0] ?? "");
  const warnings = [];

  if (entries.length === 0) {
    return { buffer, entries: [], warnings: ["목차를 찾지 못했습니다 (표지에 【과목】 항목 없음)"] };
  }

  const printedMap = buildPrintedPageMap(texts);

  // 본문 머리글로 과목 시작 페이지를 먼저 찾아본다. 목차 쪽번호는 PDF 텍스트
  // 추출이 숫자를 흘리는 경우가 있어(2023 사이버: 20 -> 0) 2순위로 둔다.
  const headerStarts = new Map();
  for (let i = 1; i < texts.length; i++) {
    const m = texts[i].match(BODY_HEADER_RE);
    if (!m) continue;
    const norm = m[1].replace(/\s+/g, "");
    // 가장 길게 일치하는 과목명을 고른다 (형사소송법 vs 형사소송법개론 대비).
    const hit = entries
      .filter((e) => norm.startsWith(e.subject.replace(/[․‧∙・·]/g, "")))
      .sort((a, b) => b.subject.length - a.subject.length)[0];
    if (hit && !headerStarts.has(hit.subject)) headerStarts.set(hit.subject, i + 1);
  }
  const headerUsable =
    entries.every((e) => headerStarts.has(e.subject)) &&
    entries.every(
      (e, i) => i === 0 || headerStarts.get(e.subject) > headerStarts.get(entries[i - 1].subject),
    );

  const resolved = entries.map((e) => ({
    ...e,
    source: headerUsable ? "머리글" : "목차",
    startPdf: headerUsable
      ? headerStarts.get(e.subject)
      : (printedMap.get(e.startPrinted) ?? null),
  }));

  // 목차 쪽번호에 의존할 때만, 깨져 읽힌 값(예: 0)을 오름차순 검증으로 잡는다.
  if (!headerUsable) {
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].startPrinted <= entries[i - 1].startPrinted) {
        warnings.push(
          `목차 쪽번호가 오름차순이 아님: ${entries[i - 1].subject}@${entries[i - 1].startPrinted} -> ${entries[i].subject}@${entries[i].startPrinted}`,
        );
      }
    }
  }

  for (const e of resolved) {
    if (e.startPdf == null) {
      warnings.push(`${e.subject}: 쪽번호 ${e.startPrinted}에 해당하는 본문 페이지를 찾지 못함`);
    }
  }

  const lastPage = texts.length;
  for (let i = 0; i < resolved.length; i++) {
    const e = resolved[i];
    if (e.startPdf == null) continue;
    const nextStart = resolved
      .slice(i + 1)
      .map((x) => x.startPdf)
      .find((x) => x != null);
    e.endPdf = (nextStart ?? lastPage + 1) - 1;
    if (e.endPdf < e.startPdf) {
      warnings.push(`${e.subject}: 페이지 범위가 비어 있음 (${e.startPdf}~${e.endPdf})`);
      continue;
    }
    // 과목 첫 쪽에 1번 문제가 없으면 경계가 어긋난 것이다. PDF 텍스트 추출 순서가
    // 조판에 따라 뒤섞이는 페이지가 있어(2019 2교시 행정학: 보기 표가 먼저 나옴)
    // 페이지 앞부분만 보지 않고 페이지 전체에서 찾는다.
    const head = texts[e.startPdf - 1];
    if (!FIRST_QUESTION_RE.test(head)) {
      warnings.push(
        `${e.subject}: 시작 페이지 p${e.startPdf}에서 1번 문제를 찾지 못함 — 경계 확인 필요`,
      );
    }
  }

  return { buffer, entries: resolved, warnings };
}

async function splitFile(filePath, outDir, dry, seen) {
  const { buffer, entries, warnings } = await analyze(filePath);
  console.log(`\n### ${path.basename(filePath)}`);
  for (const e of entries) {
    console.log(
      `  ${e.subject} (${e.note}) p${e.startPdf ?? "?"}~${e.endPdf ?? "?"} [쪽번호 ${e.startPrinted}]`,
    );
  }
  warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  if (warnings.length > 0) {
    console.log("  → 경고가 있어 이 파일은 자르지 않습니다.");
    return { written: 0, failed: 1 };
  }
  if (dry) return { written: 0, failed: 0 };

  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  await mkdir(outDir, { recursive: true });
  let written = 0;
  for (const e of entries) {
    if (seen.has(e.subject)) {
      console.log(`  건너뜀: ${e.subject} (같은 배치에서 이미 추출됨)`);
      continue;
    }
    const outDoc = await PDFDocument.create();
    const indices = [];
    for (let p = e.startPdf; p <= e.endPdf; p++) indices.push(p - 1);
    const pages = await outDoc.copyPages(srcDoc, indices);
    pages.forEach((p) => outDoc.addPage(p));
    // 과목명은 PDF 표지에서 뽑은 값이라 경로 문자가 섞일 수 있다(lib/safe-filename.mjs).
    const outPath = safeOutPath(outDir, e.subject);
    if (!outPath) {
      console.warn(
        `  ! 건너뜀: 과목명 "${e.subject}" 이 파일 이름으로 쓸 수 없다(PDF 에서 뽑은 값이라 경로 문자가 섞일 수 있다).`,
      );
      continue;
    }
    await writeFile(outPath, await outDoc.save());
    seen.add(e.subject);
    written++;
    console.log(`  저장: ${outPath} (${indices.length}쪽)`);
  }
  return { written, failed: 0 };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args.out ?? "uploads/incoming";
  const dry = Boolean(args.dry);

  let files = [];
  if (args.file) {
    files = [args.file];
  } else if (args.dir) {
    files = (await readdir(args.dir))
      .filter((f) => f.toLowerCase().endsWith(".pdf"))
      .sort()
      .map((f) => path.join(args.dir, f));
  } else {
    console.error('사용법: npm run split-by-toc -- --file "경로.pdf" --out uploads/incoming [--dry]');
    process.exit(1);
  }

  const seen = new Set();
  let written = 0;
  let failed = 0;
  for (const f of files) {
    const r = await splitFile(f, outDir, dry, seen);
    written += r.written;
    failed += r.failed;
  }
  console.log(`\n총 ${written}개 과목 저장, 경고로 건너뛴 파일 ${failed}개.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
