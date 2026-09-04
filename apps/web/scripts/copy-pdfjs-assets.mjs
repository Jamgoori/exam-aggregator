// postinstall 전용. 설치된 pdfjs-dist 에서 브라우저가 같은 출처로 받아야 하는
// 파일들을 public/ 으로 복사한다. CDN 을 쓰지 않고 설치된 버전과 정확히 맞물리게
// 하려는 것이라, 파일은 레포에 커밋된 채로 두고 매 설치마다 덮어쓴다.
//
//  1. 워커(pdf.worker.min.mjs)
//  2. wasm 디코더(wasm/) — pdfjs-dist 6 부터 JBIG2·JPEG2000 디코더가 wasm 으로
//     빠졌다. `wasmUrl` 로 이 경로를 주지 않으면 그런 이미지가 든 XObject 를
//     **에러 없이 통째로 건너뛴다.** 국내 시험지 PDF 는 선지 번호(①~⑤)·보기 상자·
//     도표를 JBIG2 흑백 이미지로 심어둔 조판이 흔해서, 없으면 문제지 뷰어에서
//     선지 번호가 통째로 안 보인다(실측: 2022 국가직 9급 공직선거법).
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publicDir = path.join(import.meta.dirname, "..", "public");

fs.copyFileSync(
  require.resolve("pdfjs-dist/legacy/build/pdf.worker.min.mjs"),
  path.join(publicDir, "pdf.worker.min.mjs"),
);

const wasmSrc = path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "wasm");
const wasmDest = path.join(publicDir, "pdf-wasm");
fs.mkdirSync(wasmDest, { recursive: true });
for (const name of fs.readdirSync(wasmSrc)) {
  if (name.startsWith("LICENSE")) continue;
  fs.copyFileSync(path.join(wasmSrc, name), path.join(wasmDest, name));
}
