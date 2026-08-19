// 사용법:
//   npm run split-by-subject-header -- --dir "src/testpaper/2024 국회직 9급" --out uploads/incoming/2024-국회직 [--dry]
//
// 국회직처럼 한 PDF에 여러 과목이 묶여 있고, 여러 직렬 PDF가 같은 연도의 공통과목
// (국어/영어/한국사 등)을 그대로 중복해서 담고 있는 경우를 위한 스크립트.
// 페이지 헤더("...채용시험 국 어 - 1 - ...")에 과목명이 그대로 박혀 있어서, 사람이
// 페이지 번호를 눈으로 세지 않아도 헤더 텍스트만으로 과목 경계를 자동으로 찾을 수 있다.
// --dir 안의 모든 PDF를 훑어서, 같은 과목명이 여러 파일에 걸쳐 나오면(예: 국어가 8개
// 직렬 PDF에 다 들어있음) 1개만 남긴다 - 국가 공식 문제은행 특성상 같은 해 같은 과목은
// 어느 직렬에서 보든 동일 문제이기 때문. 다만 이 가정이 깨지는 경우(문제가 다름)를
// 놓치지 않도록, 같은 과목명이 여러 파일에서 나오면 페이지 수와 각 페이지 텍스트를
// 비교해서 다르면 경고만 출력하고 그 과목은 사람이 직접 확인하도록 SKIP한다.
//
// --dry로 먼저 돌려서 과목 목록/페이지 범위/경고를 확인한 뒤, 문제없으면 --dry 없이
// 실제로 잘라서 --out에 "과목명.pdf"로 저장한다 (scripts/bulk-upload.mjs가 그대로 집어감).

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { safeOutPath } from "./lib/safe-filename.mjs";
import path from "node:path";

// "채용시험" 뒤에 과목명이 오는 해가 대부분이지만, 8급 시험은 "8급시험"으로만
// 끝나는 해도 있어서 "시험"으로 넓게 잡는다.
// 쪽번호가 "- 1 -"처럼 대시로 감싸인 해가 대부분이지만, 대시 없이 그냥 "1"만
// 찍힌 해도 있어서 대시는 있어도 되고 없어도 되게 둔다.
// 일부 연도(2019 등)는 PDF 텍스트 추출 순서가 꼬여서 "시험" 바로 뒤에 연도/급수
// 숫자("2019 8")가 먼저 나오고 그 다음에 과목명이 나오므로, 그 패턴을 먼저 건너뛴다.
const HEADER_RE = /시험\s+(?:\d{4}\s+\d{1,2}\s+)?(.+?)\s*-?\s*\d+\s*-?(?=\s)/;
// 책형 표기가 "국어 책형 가"(끝이 "책형가") 형태인 해와, "책형" 없이 "국어 가 형"
// (끝이 "가형") 형태로만 나오는 해가 둘 다 있어서 두 패턴 다 제거한다.
const TYPE_SUFFIX_RE = /(책형[가-힣]?|[가-라]형)$/;
// 8급 시험은 헤더에 "1교시/2교시/3교시"가 과목명 앞에 붙어 나오는 해가 있다.
const SESSION_PREFIX_RE = /^\d교시/;
// 표지 페이지("...채용시험 문제 가형 1교시 국어ㆍ헌법ㆍ경제학...")가 대시 없는
// 쪽번호 매칭 때문에 우연히 걸릴 때 나오는 가짜 과목명. 실제 과목이 아니므로 제외.
const FAKE_SUBJECT_NAMES = new Set(["문제"]);

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

async function getPageInfos(buffer) {
  const pdf = await getDocument({ data: new Uint8Array(buffer) }).promise;
  const infos = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    const text = tc.items
      .map((it) => it.str)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    const m = text.match(HEADER_RE);
    let subject = null;
    // 헤더(연도+시험명+과목명+쪽번호)는 같은 문서 안에서도 위치에 따라 달라지므로
    // ("- 11 -" vs "- 16 -" 처럼) 내용 비교 시 제외하고 본문만 남긴다.
    let body = text;
    if (m) {
      subject = m[1]
        .replace(/\s+/g, "")
        .replace(TYPE_SUFFIX_RE, "")
        .replace(SESSION_PREFIX_RE, "");
      if (FAKE_SUBJECT_NAMES.has(subject)) subject = null;
      body = text.slice(m.index + m[0].length).trim();
    }
    infos.push({ page: i, subject, text: body });
  }
  return infos;
}

function groupBySubject(infos) {
  const groups = [];
  let cur = null;
  for (const info of infos) {
    if (!info.subject) {
      cur = null;
      continue;
    }
    if (cur && cur.subject === info.subject) {
      cur.end = info.page;
      cur.texts.push(info.text);
    } else {
      cur = { subject: info.subject, start: info.page, end: info.page, texts: [info.text] };
      groups.push(cur);
    }
  }
  return groups;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir;
  const outDir = args.out;
  const dry = Boolean(args.dry);

  if (!dir || !outDir) {
    console.error(
      '사용법: npm run split-by-subject-header -- --dir "src/testpaper/2024 국회직 9급" --out uploads/incoming/2024-국회직 [--dry]',
    );
    process.exit(1);
  }

  const entries = await readdir(dir, { withFileTypes: true });
  const pdfFiles = entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".pdf"))
    .map((e) => e.name)
    .sort();

  if (pdfFiles.length === 0) {
    console.log(`${dir} 안에 PDF가 없습니다.`);
    return;
  }

  // subjectName -> { file, start, end, texts, buffer }
  const chosen = new Map();
  const warnings = [];

  for (const filename of pdfFiles) {
    const filePath = path.join(dir, filename);
    const buffer = await readFile(filePath);
    const infos = await getPageInfos(buffer);
    const allGroups = groupBySubject(infos);
    // 표지 페이지(1쪽)에 "가형제 1과목", "문제 가형 1교시" 같은 책형/과목안내 문구가
    // 대시 없는 쪽번호 매칭 때문에 우연히 걸리는 경우가 있다. 실제 과목은 지금까지
    // 최소 2쪽 이상이었으므로, 1쪽짜리 그룹이 문서 맨 앞(1쪽)에서 시작하면 표지로
    // 보고 제외한다(대신 눈에 띄게 로그로 남긴다).
    const groups = allGroups.filter((g) => !(g.start === 1 && g.end === 1));
    const droppedCovers = allGroups.filter((g) => g.start === 1 && g.end === 1);

    console.log(`\n[${filename}] 총 ${infos.length}쪽`);
    for (const g of droppedCovers) {
      console.log(`  (표지로 판단해 제외: "${g.subject}" p1)`);
    }
    for (const g of groups) {
      console.log(`  - ${g.subject}: p${g.start}~p${g.end} (${g.end - g.start + 1}쪽)`);
    }

    for (const g of groups) {
      const existing = chosen.get(g.subject);
      if (!existing) {
        chosen.set(g.subject, { file: filename, start: g.start, end: g.end, texts: g.texts, buffer });
        continue;
      }
      // 이미 다른 파일에서 같은 과목명을 봤음 -> 내용이 동일한지 검증.
      // PDF 폰트 임베딩 차이로 대시(―)나 옛한글 자모 주변에 공백이 하나씩 더 들어가는
      // 등 자간 상 노이즈가 있어서, 비교 시 공백을 전부 제거하고 비교한다.
      const norm = (arr) => arr.join("").replace(/\s+/g, "");
      const sameText = norm(existing.texts) === norm(g.texts);
      if (!sameText) {
        warnings.push(
          `"${g.subject}" 과목이 ${existing.file}(${existing.texts.length}쪽)와 ${filename}(${g.texts.length}쪽)에서 ` +
            `내용이 다릅니다. 자동 중복제거를 하지 않고 사람이 직접 확인해야 합니다.`,
        );
      }
    }
  }

  console.log(`\n총 ${chosen.size}개 고유 과목 발견.`);
  if (warnings.length > 0) {
    console.log(`\n⚠ 경고 ${warnings.length}건 (반드시 확인 후 진행):`);
    warnings.forEach((w) => console.log(`  - ${w}`));
  }

  if (dry) {
    console.log("\n--dry 모드: 실제 파일은 만들지 않았습니다.");
    return;
  }

  if (warnings.length > 0 && !args.force) {
    console.error(
      "\n경고가 있어 중단합니다. --dry로 다시 확인하거나, 사람이 직접 원본을 대조해 문제없음을 " +
        "확인했다면 --force로 강제 진행하세요.",
    );
    process.exit(1);
  }

  await mkdir(outDir, { recursive: true });

  for (const [subject, info] of chosen) {
    const srcDoc = await PDFDocument.load(info.buffer, { ignoreEncryption: true });
    const pageIndices = Array.from(
      { length: info.end - info.start + 1 },
      (_, k) => info.start - 1 + k,
    );
    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();
    // 과목명은 페이지 머리글에서 뽑은 값이라 경로 문자가 섞일 수 있다(lib/safe-filename.mjs).
    const outPath = safeOutPath(outDir, subject);
    if (!outPath) {
      console.warn(
        `  ! 건너뜀: 과목명 "${subject}" 이 파일 이름으로 쓸 수 없다(PDF 에서 뽑은 값이라 경로 문자가 섞일 수 있다).`,
      );
      continue;
    }
    await writeFile(outPath, outBytes);
    console.log(`저장: ${outPath} (출처: ${info.file}, p${info.start}~p${info.end})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
