// 사용법:
//   1) 탐지: npm run split-combined-pdf -- --file "경로.pdf" --detect
//      각 페이지의 텍스트를 훑어 "문 1." / "1." 로 새 과목이 시작될 만한 페이지를
//      후보로 출력한다. 지문 속에 우연히 섞인 "1."(예: 조약 조문, 보기 번호)도
//      후보에 낄 수 있으니 반드시 눈으로 확인 후 --boundaries 값을 정할 것.
//   2) 분리: npm run split-combined-pdf -- --file "경로.pdf" \
//            --subjects "국어,한국사,영어,소방학개론,행정법총론" \
//            --boundaries "5,9,13,17,21" --out uploads/incoming
//      boundaries는 각 과목이 시작하는 1-based 페이지 번호(오름차순, subjects와
//      개수가 같아야 함). 마지막 과목은 문서 끝까지로 처리한다.
//      결과는 "과목명.pdf"로 저장되어 scripts/bulk-upload.mjs가 그대로 집어갈 수 있다.

import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument } from "pdf-lib";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const START_RE = /(?<!\d)(?:문\s*)?1\s*[.。](?!\d)/;
const CANDIDATE_IDX_THRESHOLD = 150;

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

async function getPageTexts(pdfBuffer) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const tc = await page.getTextContent();
    texts.push(tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim());
  }
  return texts;
}

async function detect(filePath) {
  const buffer = await readFile(filePath);
  const texts = await getPageTexts(buffer);
  console.log(`총 ${texts.length}페이지. "문 1." 재시작 후보 (idx가 작을수록 신뢰도 높음):\n`);
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    const m = START_RE.exec(text);
    const idx = m ? m.index : -1;
    const isCandidate = idx >= 0 && idx <= CANDIDATE_IDX_THRESHOLD;
    const marker = isCandidate ? "★ 후보" : "  ";
    console.log(
      `${marker} p${String(i + 1).padStart(3)} idx=${String(idx).padStart(4)}  ${text.slice(0, 70)}`,
    );
  }
  console.log(
    `\n★ 표시된 페이지 중 실제로 새 과목이 시작되는 페이지만 골라 --boundaries 값으로 넘기세요.`,
  );
}

async function split(filePath, subjectNames, boundaries, outDir) {
  if (subjectNames.length !== boundaries.length) {
    throw new Error(
      `subjects(${subjectNames.length}개)와 boundaries(${boundaries.length}개) 개수가 다릅니다.`,
    );
  }
  for (let i = 1; i < boundaries.length; i++) {
    if (boundaries[i] <= boundaries[i - 1]) {
      throw new Error(`boundaries는 오름차순이어야 합니다: ${boundaries.join(",")}`);
    }
  }

  const buffer = await readFile(filePath);
  const srcDoc = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const totalPages = srcDoc.getPageCount();
  if (boundaries[0] < 1 || boundaries[boundaries.length - 1] > totalPages) {
    throw new Error(`boundaries가 문서 범위(1~${totalPages})를 벗어났습니다.`);
  }

  await mkdir(outDir, { recursive: true });

  for (let i = 0; i < subjectNames.length; i++) {
    const start = boundaries[i] - 1; // 0-based
    const end = i + 1 < boundaries.length ? boundaries[i + 1] - 1 : totalPages;
    const pageIndices = Array.from({ length: end - start }, (_, k) => start + k);

    const outDoc = await PDFDocument.create();
    const copiedPages = await outDoc.copyPages(srcDoc, pageIndices);
    copiedPages.forEach((p) => outDoc.addPage(p));
    const outBytes = await outDoc.save();

    const fileName = `${subjectNames[i]}.pdf`;
    const outPath = path.join(outDir, fileName);
    await writeFile(outPath, outBytes);
    console.log(
      `${fileName}: p${start + 1}~p${end} (${pageIndices.length}쪽) -> ${outPath}`,
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = args.file;
  if (!filePath) {
    console.error(
      '사용법: npm run split-combined-pdf -- --file "경로.pdf" --detect\n' +
        '   또는: npm run split-combined-pdf -- --file "경로.pdf" --subjects "국어,영어" --boundaries "5,9" --out uploads/incoming',
    );
    process.exit(1);
  }

  if (args.detect) {
    await detect(filePath);
    return;
  }

  if (!args.subjects || !args.boundaries) {
    console.error("--subjects와 --boundaries를 지정하거나 --detect로 먼저 확인하세요.");
    process.exit(1);
  }

  const subjectNames = String(args.subjects)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const boundaries = String(args.boundaries)
    .split(",")
    .map((s) => Number(s.trim()));
  const outDir = args.out ?? "uploads/incoming";

  await split(filePath, subjectNames, boundaries, outDir);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
