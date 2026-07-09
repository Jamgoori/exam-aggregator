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
import { pathToFileURL } from "node:url";

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
// 앞의 "문" 표시는 보통 번호와 별도 조각으로 떨어지지만("문" / "1. ...") 일부
// 문제지(옛날 PDF 등)는 같은 조각에 "문 11. ..."처럼 붙어 나온다 — 이 경우도
// 놓치지 않도록 선택적 "문" 접두사를 허용한다.
const QUESTION_MARKER_RE = /^(?:문\s*)?(\d{1,3})\.(?:\s|$)/;

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

// 숫자만 있는 조각("19")과 마침표만 있는 조각(".")이 완전히 따로 떨어져 나오는
// PDF도 있다 — 이 경우 QUESTION_MARKER_RE가 어느 조각에도 안 걸려 마커를 통째로
// 놓친다. 같은 줄(y 거의 동일)에서 숫자 조각 바로 다음에 마침표 조각이 가깝게
// (폭 20pt 이내) 붙어 있으면 같은 마커로 합쳐 인식한다.
const BARE_NUMBER_RE = /^(?:문\s*)?(\d{1,3})$/;

// "[문 2.～문 4.] 밑줄 친 부분에 들어갈 말로..." / "[7～8] 다음 글을 읽고 물음에
// 답하시오." 처럼 여러 문제에 걸리는 안내문에는 항상 대괄호로 감싼 "N~M" 번호
// 범위가 있다. 과목에 따라 앞에 "※"가 붙기도 하고(영어) 안 붙기도 해서(국어)
// "※" 유무로는 못 가리므로, 대괄호 패턴 자체를 앵커로 삼는다. 이 줄 안에도
// "N." 형태가 그대로 들어있어 진짜 마커와 똑같이 매치되니, 이 줄(y, 칼럼 동일)에
// 서는 숫자 마커 후보를 아예 인정하지 않는다 — 2단 조판이라 왼쪽 칼럼의 진짜
// 마커와 오른쪽 칼럼의 안내문이 페이지 맨 위 등에서 우연히 같은 y에 놓일 수
// 있으므로, y뿐 아니라 같은 칼럼(좌/우)인지까지 같이 봐야 한다.
const ANNOTATION_RANGE_RE = /\[\s*(?:문\s*)?(\d{1,3})\s*\.?\s*[～~]\s*(?:문\s*)?(\d{1,3})\s*\.?\s*\]/;

function findAnnotationLines(items, half) {
  const lines = new Map();
  for (const item of items) {
    const [, , , , x, y] = item.transform;
    const col = x < half ? "L" : "R";
    const key = `${y}|${col}`;
    if (!lines.has(key)) lines.set(key, { y, col, parts: [] });
    lines.get(key).parts.push({ x, str: item.str });
  }

  const keys = new Set();
  const groups = [];
  for (const [key, line] of lines) {
    const text = line.parts.sort((a, b) => a.x - b.x).map((p) => p.str).join("");
    const match = ANNOTATION_RANGE_RE.exec(text);
    if (!match) continue;
    keys.add(key);
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (end > start && end - start <= 10) {
      groups.push({ start, end, y: line.y, col: line.col });
    }
  }
  return { keys, groups };
}

async function findQuestionMarkers(page) {
  const viewport = page.getViewport({ scale: 1 });
  const textContent = await page.getTextContent();
  const items = textContent.items.filter((i) => "str" in i);
  const half = viewport.width / 2;
  const { keys: annotationKeys, groups } = findAnnotationLines(items, half);
  const markers = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const str = item.str.trim();
    if (!str) continue;
    const [, , , , itemX, itemY] = item.transform;
    if (annotationKeys.has(`${itemY}|${itemX < half ? "L" : "R"}`)) continue;

    const match = QUESTION_MARKER_RE.exec(str);
    if (match) {
      const [, numStr] = match;
      const [, , , , x, y] = item.transform;
      markers.push({ number: Number(numStr), x, y, height: item.height });
      continue;
    }

    const bareMatch = BARE_NUMBER_RE.exec(str);
    if (!bareMatch) continue;
    const next = items[i + 1];
    if (!next || next.str.trim() !== ".") continue;
    const [, , , , x1, y1] = item.transform;
    const [, , , , x2, y2] = next.transform;
    if (Math.abs(y1 - y2) > 2 || x2 <= x1 || x2 - x1 > 20) continue;
    markers.push({ number: Number(bareMatch[1]), x: x1, y: y1, height: item.height });
  }
  return { markers, groups, pageWidthPt: viewport.width, pageHeightPt: viewport.height };
}

// 진짜 문제 마커는 항상 그 단의 왼쪽 여백에 붙어 나온다(hanging indent). 국어·영어·
// 한국사처럼 지문이 있는 과목은 지문 안에 번호 매긴 보기/예시가 들어있는 경우가
// 있는데("1. 첫 문장 2. 둘째 문장"), 본문 들여쓰기만큼 더 오른쪽에 찍혀 같은
// 정규식에 걸린다(실측상 여백보다 27pt+ 안쪽). 반면 "문"과 번호가 같은 텍스트
// 조각으로 합쳐지는지 여부·한 자릿수/두 자릿수 숫자 폭 차이로 진짜 마커끼리도
// x가 몇~십몇 pt씩 흔들린다(실측 최대 ~17pt). 그래서 "최솟값 기준 고정
// 허용오차" 대신, x를 정렬한 뒤 인접한 값끼리 간격(gap)이 좁으면 같은 묶음으로
// 보는 클러스터링을 쓴다 — 진짜 마커끼리의 흔들림(~17pt)보다는 크고 지문
// 들여쓰기 간격(~27pt+)보다는 작은 값으로 잡아야 두 경우가 갈린다. 여백 쪽
// 묶음(가장 왼쪽)만 남기고, 그 너머(지문 속 텍스트)는 버린다.
const MARGIN_CLUSTER_GAP_PT = 22;

function filterMarginMarkers(columnMarkers) {
  if (columnMarkers.length === 0) return columnMarkers;
  const sorted = [...columnMarkers].sort((a, b) => a.x - b.x);
  let clusterEndIndex = 0;
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].x - sorted[i - 1].x > MARGIN_CLUSTER_GAP_PT) break;
    clusterEndIndex = i;
  }
  const marginX = new Set(sorted.slice(0, clusterEndIndex + 1).map((m) => m.x));
  return columnMarkers.filter((m) => marginX.has(m.x));
}

// 페이지 안의 마커들을 x좌표 기준으로 좌/우 두 단으로 나누고, 각 단 안에서
// 위→아래 순서(= y 내림차순, PDF 좌표는 위로 갈수록 y가 큼)로 정렬한다.
function splitIntoColumns(markers, pageWidthPt) {
  const half = pageWidthPt / 2;
  const left = filterMarginMarkers(markers.filter((m) => m.x < half)).sort((a, b) => b.y - a.y);
  const right = filterMarginMarkers(markers.filter((m) => m.x >= half)).sort((a, b) => b.y - a.y);
  return { left, right, half };
}

// 안내문이 걸린 문제 범위(N~M)라고 해서 다 지문을 공유하는 건 아니다. 실측해
// 보니 두 가지 서로 다른 관례가 섞여 있다:
//   - "다음 글을 읽고 물음에 답하시오. [7~8]" 같은 진짜 공통지문형은 안내문과
//     첫 문제(N) 마커 사이에 지문 전체가 끼어 있어 그 간격이 아주 크다(실측
//     약 590pt). N~M 사이 각 문제 자체는 지문 없이 짧다.
//   - "밑줄 친 부분에 들어갈 말로 가장 적절한 것을 고르시오. [2~4]" 같은
//     지시문 재사용형은 안내문 바로 다음 줄에 곧장 N번 마커가 오고(실측
//     12~21pt), N~M 각 문제가 저마다 자기 지문/보기를 따로 갖는다.
// 이 둘을 안내문 문구만으로는 구분할 수 없어(둘 다 "다음 글을..."로 시작할 수
// 있음), "안내문→첫 마커 간격"과 "문제 사이 평균 간격"을 실제로 재서 비교한다.
// 앞이 뒤보다 압도적으로 크면(지문이 낀 것) 그때만 통째로 묶는다 — 아니면
// 개별로 잘랐을 때 이미 각 문제가 자기 내용을 온전히 담고 있으므로 손대지 않는다.
const GROUP_GAP_RATIO = 2.5;
const GROUP_MIN_GAP_PT = 150;

// 각 마커에 대해 [top, bottom] (PDF pt, y가 큰 쪽이 위) 크롭 영역을 계산한다.
function computeRowsForColumn(column, pageHeightPt, groups) {
  const rows = [];
  let i = 0;
  while (i < column.length) {
    const marker = column[i];
    const group = groups.find((g) => g.start === marker.number);
    if (group) {
      let j = i;
      while (j < column.length && column[j].number <= group.end) j++;
      const lastConsumed = column[j - 1];
      // 그룹 끝 번호가 이 칼럼 안에서 실제로 발견됐을 때만(칼럼 경계를 넘지
      // 않을 때만) 병합을 고려한다.
      if (lastConsumed && lastConsumed.number === group.end && j - i >= 2) {
        const gapBeforeFirst = group.y - marker.y;
        const gapsBetween = [];
        for (let k = i; k < j - 1; k++) gapsBetween.push(column[k].y - column[k + 1].y);
        const avgBetween = gapsBetween.reduce((a, b) => a + b, 0) / gapsBetween.length;
        const isSharedPassage = gapBeforeFirst >= GROUP_MIN_GAP_PT && gapBeforeFirst >= avgBetween * GROUP_GAP_RATIO;
        if (isSharedPassage) {
          const afterGroup = column[j];
          const top = Math.min(pageHeightPt, group.y + TOP_PAD);
          const bottom = afterGroup ? afterGroup.y + TOP_PAD : BOTTOM_MARGIN;
          const groupNumbers = [];
          for (let n = group.start; n <= group.end; n++) groupNumbers.push(n);
          rows.push({ number: group.start, groupNumbers, top, bottom });
          i = j;
          continue;
        }
      }
    }
    const next = column[i + 1];
    const top = Math.min(pageHeightPt, marker.y + marker.height + TOP_PAD);
    const bottom = next ? next.y + TOP_PAD : BOTTOM_MARGIN;
    rows.push({ number: marker.number, top, bottom });
    i++;
  }
  return rows;
}

async function cropQuestionsFromPage(page, scale) {
  const { markers, groups, pageWidthPt, pageHeightPt } = await findQuestionMarkers(page);
  if (markers.length === 0) return [];

  const { left, right, half } = splitIntoColumns(markers, pageWidthPt);
  const { buffer: pageImage, width: pageWidthPx, height: pageHeightPx } =
    await renderPageToPng(page, scale);

  const leftGroups = groups.filter((g) => g.col === "L");
  const rightGroups = groups.filter((g) => g.col === "R");

  const results = [];
  const columns = [
    { rows: computeRowsForColumn(left, pageHeightPt, leftGroups), xLeftPt: PAGE_MARGIN_X, xRightPt: half - COLUMN_GAP },
    { rows: computeRowsForColumn(right, pageHeightPt, rightGroups), xLeftPt: half + COLUMN_GAP, xRightPt: pageWidthPt - PAGE_MARGIN_X },
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

      // 공통지문형으로 병합된 행은 그룹에 속한 모든 번호에 같은 이미지를
      // 그대로 등록한다 — 어느 번호로 들어가든 지문+전체 문제가 함께 보이게.
      for (const number of row.groupNumbers ?? [row.number]) {
        results.push({ number, image: cropped });
      }
    }
  }

  return results;
}

// PDF 버퍼 전체를 문항별로 잘라 { number, image } 목록을 반환한다. 페이지 순회,
// 정렬, 번호 중복 검사까지 여기서 끝내고, 호출자는 결과를 업로드/DB 반영만 하면
// 된다 — main()의 단일 문제지 흐름과 batch-crop-questions.mjs의 여러 문제지 순회가
// 이 함수 하나를 공유한다. 중복 번호가 감지되면(레이아웃 오인식) 에러를 던진다.
export async function extractQuestionsFromPdf(pdfBuffer, { scale = 3, onPage } = {}) {
  const pdf = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;

  const cropped = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const pageResults = await cropQuestionsFromPage(page, scale);
    cropped.push(...pageResults);
    onPage?.(p, pageResults);
  }

  cropped.sort((a, b) => a.number - b.number);

  const seen = new Set();
  for (const c of cropped) {
    if (seen.has(c.number)) {
      throw new Error(`문제 번호 중복 감지: ${c.number}번이 두 번 잘렸습니다. 레이아웃 인식을 확인하세요.`);
    }
    seen.add(c.number);
  }

  return cropped;
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

  let cropped;
  try {
    cropped = await extractQuestionsFromPdf(pdfBuffer, {
      scale,
      onPage: (p, pageResults) =>
        console.log(`페이지 ${p}: 문제 ${pageResults.map((r) => r.number).join(", ") || "(없음)"}`),
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
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

// batch-crop-questions.mjs가 extractQuestionsFromPdf만 가져다 쓰려고 import할 때는
// 이 CLI용 main()이 (process.argv를 오독하며) 같이 실행되면 안 되므로, 직접 실행된
// 경우에만 돌린다.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
