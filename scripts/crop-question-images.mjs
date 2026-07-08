// 사용법: npm run crop-questions -- --paper-id <uuid> [--dry-run] [--scale 3]
//
// exam_papers에 이미 업로드된 문제지 PDF를 다운로드해서, 페이지 텍스트 레이아웃에서
// "N." 형태의 문제 번호 위치를 찾아 2단 편집 기준으로 문항별 영역을 잘라낸다.
// 잘라낸 이미지는 exam-papers 버킷의 questions/<paperId>/ 아래 업로드하고,
// questions/question_images 테이블에 등록한다 (재실행 시 upsert로 덮어씀).
//
// 이 스크립트는 "좌우 2단 조판 + 문제 번호가 각 단 왼쪽 여백에 붙는" 표준 공무원
// 시험 PDF 레이아웃을 가정한다. 다른 레이아웃(1단, 3단, 공통지문 등)은 지원하지 않는다.

import { createClient } from "@supabase/supabase-js";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// 문제 번호 마커: 줄 맨 앞의 "12." 같은 토큰. 정답표의 "①" 등 선지 기호와
// 헷갈리지 않도록 아라비아 숫자 + 마침표 형태만 허용한다.
// PDF 텍스트 추출은 낱말 경계가 아니라 원본 조판의 텍스트 조각(run) 단위로 잘리기
// 때문에, 문제가 "(가)"나 "1910년"처럼 괄호/숫자로 곧장 시작하면 "2. ("나 "18. 1910"
// 처럼 마커 뒤 내용이 같은 조각에 붙어버려 예전 정규식(완전 일치)이 놓쳤다. 접두사만
// 확인하도록 완화한다 — 문단 안 번호 목록("1. 첫 번째 사료")을 잘못 집어도, 같은
// 번호가 실제 문제 마커와 충돌하면 아래 main()의 "문제 번호 중복 감지"가 하드
// 에러로 멈춰 안전망 역할을 한다.
const QUESTION_MARKER_RE = /^(\d{1,3})\.(?:\s|$)/;

// 문제 번호 마커의 텍스트 상단(marker.y 기준 위쪽 여백). 다음 문제와의 간격이
// 실측상 최소 30pt 이상이라 10pt 정도는 어느 쪽 문제 내용도 침범하지 않는다.
const TOP_PAD = 10;
// 단(칼럼) 안쪽 여백 및 페이지 좌우 여백
const COLUMN_GAP = 4;
const PAGE_MARGIN_X = 6;
// 마지막 문제(다음 마커가 없는 경우)는 페이지 하단까지 넉넉히 잘라서 잘림을 방지
const BOTTOM_MARGIN = 4;

async function renderPageToPng(page, scale) {
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(viewport.width, viewport.height);
  const context = canvas.getContext("2d");
  await page.render({ canvasContext: context, viewport }).promise;
  return { buffer: canvas.toBuffer("image/png"), width: viewport.width, height: viewport.height };
}

async function findQuestionMarkers(page) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const markers = [];
  for (const item of textContent.items) {
    if (!("str" in item)) continue;
    const match = QUESTION_MARKER_RE.exec(item.str.trim());
    if (!match) continue;
    const [, numStr] = match;
    const [, , , , x, y] = item.transform;
    markers.push({ number: Number(numStr), x, y, height: item.height });
  }
  return { markers, pageWidthPt: viewport.width, pageHeightPt: viewport.height };
}

// 페이지 안의 마커들을 x좌표 기준으로 좌/우 두 단으로 나누고, 각 단 안에서
// 위→아래 순서(= y 내림차순, PDF 좌표는 위로 갈수록 y가 큼)로 정렬한다.
function splitIntoColumns(markers, pageWidthPt) {
  const half = pageWidthPt / 2;
  const left = markers.filter((m) => m.x < half).sort((a, b) => b.y - a.y);
  const right = markers.filter((m) => m.x >= half).sort((a, b) => b.y - a.y);
  return { left, right, half };
}

// 각 마커에 대해 [top, bottom] (PDF pt, y가 큰 쪽이 위) 크롭 영역을 계산.
function computeRowsForColumn(column, pageHeightPt) {
  const rows = [];
  for (let i = 0; i < column.length; i++) {
    const marker = column[i];
    const next = column[i + 1];
    const top = Math.min(pageHeightPt, marker.y + marker.height + TOP_PAD);
    const bottom = next ? next.y + TOP_PAD : BOTTOM_MARGIN;
    rows.push({ number: marker.number, top, bottom });
  }
  return rows;
}

async function cropQuestionsFromPage(page, scale) {
  const { markers, pageWidthPt, pageHeightPt } = await findQuestionMarkers(page);
  if (markers.length === 0) return [];

  const { left, right, half } = splitIntoColumns(markers, pageWidthPt);
  const { buffer: pageImage, width: pageWidthPx, height: pageHeightPx } =
    await renderPageToPng(page, scale);

  const results = [];
  const columns = [
    { rows: computeRowsForColumn(left, pageHeightPt), xLeftPt: PAGE_MARGIN_X, xRightPt: half - COLUMN_GAP },
    { rows: computeRowsForColumn(right, pageHeightPt), xLeftPt: half + COLUMN_GAP, xRightPt: pageWidthPt - PAGE_MARGIN_X },
  ];

  for (const col of columns) {
    for (const row of col.rows) {
      const leftPx = Math.max(0, Math.round(col.xLeftPt * scale));
      const rightPx = Math.min(pageWidthPx, Math.round(col.xRightPt * scale));
      // PDF는 y가 위로 갈수록 커지므로, 이미지 좌표(y가 아래로 갈수록 커짐)로 뒤집는다.
      const topPx = Math.max(0, Math.round((pageHeightPt - row.top) * scale));
      const bottomPx = Math.min(pageHeightPx, Math.round((pageHeightPt - row.bottom) * scale));

      const width = rightPx - leftPx;
      const height = bottomPx - topPx;
      if (width <= 0 || height <= 0) {
        console.warn(`문제 ${row.number}: 잘라낼 영역이 비어있어 건너뜀`);
        continue;
      }

      const extracted = await sharp(pageImage)
        .extract({ left: leftPx, top: topPx, width, height })
        .png()
        .toBuffer();

      // extract()는 마커 간격 기준의 넉넉한 영역이라 마지막 문제(단 하단)는 흰
      // 여백이 크게 남는다. trim()으로 흰 여백을 걷어낸 뒤 보기 좋게 약간만 다시
      // 패딩한다. (내용이 거의 없어 trim이 실패하는 경우 원본을 그대로 쓴다.)
      // 최종 저장은 WebP 무손실로 — 문제 이미지는 사진이 아니라 흰 배경+얇은
      // 텍스트/선 위주라 PNG보다 60%대로 작아지면서 화질 손실은 없다(실측 결과).
      const pad = Math.round(8 * scale);
      let cropped;
      try {
        cropped = await sharp(extracted)
          .trim({ background: "#ffffff", threshold: 10 })
          .extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#ffffff" })
          .webp({ lossless: true })
          .toBuffer();
      } catch {
        cropped = await sharp(extracted).webp({ lossless: true }).toBuffer();
      }

      results.push({ number: row.number, image: cropped });
    }
  }

  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const paperId = args["paper-id"];
  const dryRun = Boolean(args["dry-run"]);
  const scale = args.scale ? Number(args.scale) : 3;

  if (!paperId) {
    console.error("사용법: npm run crop-questions -- --paper-id <uuid> [--dry-run]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: paper, error: paperError } = await supabase
    .from("exam_papers")
    .select("id, title, file_path, question_count, choice_count")
    .eq("id", paperId)
    .single();

  if (paperError || !paper) {
    console.error(`문제지를 찾을 수 없습니다: ${paperId}`, paperError?.message);
    process.exit(1);
  }

  console.log(`대상: ${paper.title} (${paper.file_path})`);

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(paper.file_path);
  if (downloadError || !fileBlob) {
    console.error(`PDF 다운로드 실패: ${downloadError?.message}`);
    process.exit(1);
  }
  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());

  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

  const cropped = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const pageResults = await cropQuestionsFromPage(page, scale);
    cropped.push(...pageResults);
    console.log(`페이지 ${p}: 문제 ${pageResults.map((r) => r.number).join(", ") || "(없음)"}`);
  }

  cropped.sort((a, b) => a.number - b.number);

  const seen = new Set();
  for (const c of cropped) {
    if (seen.has(c.number)) {
      console.error(`문제 번호 중복 감지: ${c.number}번이 두 번 잘렸습니다. 레이아웃 인식을 확인하세요.`);
      process.exit(1);
    }
    seen.add(c.number);
  }

  const expected = paper.question_count;
  if (expected && cropped.length !== expected) {
    console.warn(
      `주의: exam_papers.question_count=${expected}인데 ${cropped.length}개 문제만 인식됐습니다.`,
    );
  }

  if (dryRun) {
    const outDir = path.join(process.cwd(), "uploads", "crop-preview", paperId);
    await mkdir(outDir, { recursive: true });
    for (const c of cropped) {
      await writeFile(path.join(outDir, `${String(c.number).padStart(2, "0")}.webp`), c.image);
    }
    console.log(`\n[dry-run] ${cropped.length}개 이미지를 ${outDir} 에 저장했습니다. DB/Storage는 건드리지 않았습니다.`);
    return;
  }

  let uploaded = 0;
  for (const c of cropped) {
    const storagePath = `questions/${paperId}/${String(c.number).padStart(2, "0")}.webp`;

    const { error: uploadError } = await supabase.storage
      .from("exam-papers")
      .upload(storagePath, c.image, { contentType: "image/webp", upsert: true });
    if (uploadError) {
      console.error(`문제 ${c.number}: 업로드 실패 - ${uploadError.message}`);
      continue;
    }

    const { data: questionRow, error: questionError } = await supabase
      .from("questions")
      .upsert(
        {
          paper_id: paperId,
          question_number: c.number,
          choice_count: paper.choice_count ?? 4,
        },
        { onConflict: "paper_id,question_number" },
      )
      .select("id")
      .single();

    if (questionError || !questionRow) {
      console.error(`문제 ${c.number}: questions upsert 실패 - ${questionError?.message}`);
      continue;
    }

    const { error: imageError } = await supabase
      .from("question_images")
      .upsert(
        {
          question_id: questionRow.id,
          order_index: 0,
          image_path: storagePath,
        },
        { onConflict: "question_id,order_index" },
      );

    if (imageError) {
      console.error(`문제 ${c.number}: question_images upsert 실패 - ${imageError.message}`);
      continue;
    }

    uploaded++;
    console.log(`완료: ${c.number}번`);
  }

  console.log(`\n총 ${uploaded}/${cropped.length}개 문제 이미지 등록 완료.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
