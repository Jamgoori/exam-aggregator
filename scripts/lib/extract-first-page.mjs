// 사용법: node scripts/lib/extract-first-page.mjs <입력.pdf> <출력.pdf>
//
// 문제지 표지(책형 표기)만 확인하면 되는데, 시험지 전체를 Read하면 20페이지
// 제한에 걸리거나 불필요하게 느려질 수 있어 1페이지만 잘라낸다. poppler 없이도
// 동작하도록 pdf-lib(순수 JS)을 사용한다.

import { PDFDocument } from "pdf-lib";
import { readFile, writeFile } from "node:fs/promises";

async function main() {
  const [inputPath, outputPath] = process.argv.slice(2);
  if (!inputPath || !outputPath) {
    console.error("사용법: node scripts/lib/extract-first-page.mjs <입력.pdf> <출력.pdf>");
    process.exit(1);
  }

  const srcBytes = await readFile(inputPath);
  const srcDoc = await PDFDocument.load(srcBytes);
  const outDoc = await PDFDocument.create();
  const [firstPage] = await outDoc.copyPages(srcDoc, [0]);
  outDoc.addPage(firstPage);
  await writeFile(outputPath, await outDoc.save());
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
