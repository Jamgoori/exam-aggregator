// 스캔본 PDF(텍스트 레이어 0자)를 위해 **OCR 로 가짜 텍스트 레이어를 만든다.**
//
// 왜 이런 우회를 하나: `crop-question-images.mjs` 는 문항 마커·세트 안내문·되풀이
// 머리글·칼럼 경계를 전부 `page.getTextContent()` 의 조각 좌표에서 읽는다. 스캔본은
// 그 조각이 하나도 없어 "마커를 하나도 못 찾음"으로 끝난다(docs/agents/
// crop-question-images.md "텍스트 레이어가 없는 스캔 PDF는 크롭 대상이 아니다").
// 그렇다고 크롭 로직을 스캔본용으로 따로 쓰면 이미 수천 장에서 검증된 레이아웃
// 판단을 통째로 다시 만들게 된다. 그래서 **입력 쪽만 바꾼다** — OCR 결과를
// pdfjs 의 텍스트 조각과 같은 모양으로 빚어 넣으면 그 아래 로직은 손댈 게 없다.
//
// **정확도보다 일관성이 중요한 자리가 있다.** 되풀이 머리글 판정은 페이지마다
// 같은 문구인지를 보는 것이라(normalizeRunningText), 한글이 좀 틀리게 읽혀도
// 페이지마다 똑같이 틀리면 그대로 걸러진다. 반면 **문항 마커는 정확해야 한다** —
// 그래서 마커 자리에서 실측으로 흔한 오독만 좁게 보정한다(아래 normalizeMarkerish).
//
// 한계: 이 층은 "글자 위치"만 복원한다. 크롭 자체는 원본 PDF 를 그대로 렌더해
// 자르므로 이미지 품질은 OCR 과 무관하다.

import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";

// OCR 배율. **마커 인식률이 여기에 크게 달려 있다** — 실측 61회에서 3배는 마커를
// 42개만 잡았는데 4배에서는 49개를 잡았다(스캔 품질이 회차마다 달라 3배로 충분한
// 회차도 있다). 쪽당 5~6초에서 9~10초로 느려지지만, 개수가 안 맞으면 그 문제지는
// 통째로 못 올리므로 시간보다 인식률이 먼저다.
const OCR_SCALE = 4;

// 문항 마커 끝의 마침표가 쉼표로 읽히는 일이 잦다(실측 50회: "9," "11," "49,"
// — 굵은 번호 뒤 마침표가 베이스라인 아래로 번진다). 마커 정규식은 "N." 만
// 인정하므로 이 한 글자 때문에 문항이 통째로 사라진다. 숫자 1~3자리 + 종결
// 문장부호 하나로 끝나는 토막만 "N." 으로 되돌린다 — 숫자 안에 섞여 드는
// 오독("2808", "60%)")은 건드리지 않는다.
function normalizeMarkerish(text) {
  const m = /^(\d{1,3})\s*[.,·、:]$/.exec(text);
  return m ? `${m[1]}.` : text;
}

const MARKERISH_RE = /^(\d{1,3})\.$/;
// 마커 열로 인정하는 x 허용오차. 같은 칼럼의 마커는 실측상 x 가 10pt 안에 모인다
// (한 자리 수와 두 자리 수가 같은 왼쪽 끝에서 시작하지 않는 조판이 있어 0 은 아니다).
const MARKER_X_TOLERANCE_PT = 8;
// 이 개수 이상 같은 x 에 모여야 "마커 열"로 인정한다. 한 쪽에 4~5개씩 나오므로
// 문서 전체로 보면 마커 열에는 수십 개가 모이고, 본문 속 우연한 "3." 은 흩어진다.
const MARKER_CLUSTER_MIN = 5;
// 마커로 인정할 최소 OCR 신뢰도. 진짜 문항 번호는 굵고 커서 실측 77~96 으로 읽히고,
// 지문 속 얼룩이 "7," 처럼 읽힌 잡음은 15 였다(실측 50회 3쪽 — 이 하나가 마커 자리
// 수를 51 로 만들어 자리값 보정을 통째로 꺼뜨렸다).
const MARKER_MIN_CONFIDENCE = 40;

function isMarkerish(item) {
  return MARKERISH_RE.test(item.str) && (item.confidence ?? 100) >= MARKER_MIN_CONFIDENCE;
}

/**
 * 마커 후보를 숫자 전용으로 다시 읽는다.
 *
 * 본문 OCR(kor+eng)은 굵은 문항 번호에서 실측으로 틀린다 — 50회 4쪽의 "15." 를
 * "18." 로 읽어, 5쪽의 진짜 18번과 번호가 겹쳐 두 문항이 통째로 사라졌다. 번호
 * 하나가 틀리면 "개수는 맞는데 엉뚱한 문항" 이 되므로 여기서만큼은 추측이 아니라
 * **다시 읽어서** 고친다: 그 자리를 크게 잘라 숫자만 인식하는 워커에 다시 넣는다.
 */
async function refineMarkers(pngBuffer, items, digitWorker, ocrScale) {
  const candidates = items.filter(isMarkerish);
  if (candidates.length === 0) return;
  const image = sharp(pngBuffer);
  for (const item of candidates) {
    const x = item.transform[4] * ocrScale;
    const yBottom = item.transform[5] * ocrScale;
    const h = item.height * ocrScale;
    const w = item.width * ocrScale;
    const pad = Math.round(h * 0.35);
    const meta = await image.metadata();
    const left = Math.max(0, Math.round(x - pad));
    const top = Math.max(0, Math.round(meta.height - yBottom - h - pad));
    const width = Math.min(meta.width - left, Math.round(w + pad * 2));
    const height = Math.min(meta.height - top, Math.round(h + pad * 2));
    if (width <= 0 || height <= 0) continue;
    const crop = await sharp(pngBuffer)
      .extract({ left, top, width, height })
      .resize({ width: width * 3 })
      .png()
      .toBuffer();
    const { data } = await digitWorker.recognize(crop);
    const read = (data.text ?? "").replace(/[^\d]/g, "");
    const original = MARKERISH_RE.exec(item.str)[1];
    // **자릿수가 같을 때만 후보로 인정한다.** 잘라낸 자리에 옆 글자가 조금이라도
    // 걸리면 숫자 전용 워커는 그것까지 숫자로 읽는다(실측 50회: "25." 자리가
    // "206" 으로 나왔다).
    //
    // 그리고 **덮어쓰지 않고 후보로만 달아 둔다.** 두 OCR 중 어느 쪽이 맞는지는
    // 여기서 알 수 없다 — 실측 50회에서 4쪽은 본문 OCR 이 15를 18로 틀렸고(재인식이
    // 옳음), 1쪽은 재인식이 1을 5로 틀렸다(본문 OCR 이 옳음). 고르는 일은 읽기
    // 순서를 아는 chooseMarkerNumbers 가 한다.
    if (read && read.length === original.length && read !== original) item.alt = `${Number(read)}.`;
  }
}

/**
 * 마커 열에서 벗어난 "N." 은 마커가 아니다.
 *
 * 진짜 텍스트 레이어에는 없던 잡음이 OCR 에는 섞인다(실측 50회 3쪽: 지문 속
 * 숫자가 "607." 로 읽혀 51번째 문항으로 잡혔다). 문항 마커는 칼럼 왼쪽 끝에
 * 줄맞춰 서므로, x 가 모이는 자리(문서 전체 기준)에서 떨어진 후보는 마커 모양을
 * 지운다 — 조각을 지우는 게 아니라 뒤에 마침표만 떼서, 혹시 본문의 일부였다면
 * 글자 위치 정보는 그대로 남는다.
 */
function markerColumnRanges(pagesItems) {
  const xs = [];
  for (const items of pagesItems)
    for (const it of items) if (isMarkerish(it)) xs.push(it.transform[4]);
  if (xs.length === 0) return [];
  // **사슬로 잇지 말 것.** x 를 12pt 씩 이어 붙이면 48 → 57 → 68 → 79 처럼 징검다리로
  // 번져 본문 쪽 잡음까지 마커 열에 들어온다(실측 50회 1쪽: x=79 의 가짜 "4." 가
  // 살아남았다). 가장 촘촘한 자리부터 고정 폭으로 떼어 낸다.
  const remaining = [...xs].sort((a, b) => a - b);
  const ranges = [];
  while (remaining.length >= MARKER_CLUSTER_MIN) {
    let best = null;
    for (const center of remaining) {
      const members = remaining.filter((x) => Math.abs(x - center) <= MARKER_X_TOLERANCE_PT);
      if (!best || members.length > best.members.length) best = { center, members };
    }
    if (!best || best.members.length < MARKER_CLUSTER_MIN) break;
    ranges.push([best.center - MARKER_X_TOLERANCE_PT, best.center + MARKER_X_TOLERANCE_PT]);
    for (const m of best.members) remaining.splice(remaining.indexOf(m), 1);
  }
  return ranges;
}

/**
 * 마커 열에서 벗어난 "N." 은 마커가 아니다 — 마커 모양만 지운다(조각 자체는 남긴다).
 */
function dropMarkersOutsideColumns(pagesItems, ranges) {
  if (ranges.length === 0) return;
  for (const items of pagesItems) {
    for (const it of items) {
      // 신뢰도가 낮은 "N." 도 여기서 함께 지운다 — 아래 크롭 로직은 신뢰도를 모르므로,
      // 마커 모양으로 남겨 두면 그게 곧 마커가 된다.
      if (!MARKERISH_RE.test(it.str)) continue;
      const x = it.transform[4];
      const inColumn = ranges.some(([lo, hi]) => x >= lo && x <= hi);
      if (!inColumn || !isMarkerish(it)) {
        it.str = it.str.slice(0, -1);
        delete it.alt;
      }
    }
  }
}

/**
 * 마커 열만 세로로 길게 잘라 **숫자 전용으로 다시 훑는다.**
 *
 * 전면 OCR 의 단어 분할에 마커를 맡기면 인식률이 회차마다 출렁인다(실측: 같은
 * 판형인데 61회는 50개 중 42개, 65회는 39개만 잡혔다). 한글 본문과 함께 읽느라
 * 굵은 숫자가 다른 글자에 붙거나 통째로 빠지기 때문이다. 마커가 서는 자리는
 * 칼럼 왼쪽 끝 한 줄뿐이므로, 그 띠만 잘라 **숫자만 인식**하게 하면 방해할 글자가
 * 거의 없다.
 *
 * 이 패스가 그 열의 마커 목록을 대체한다(전면 OCR 이 잡았던 그 열의 마커는 지운다).
 * 열 밖의 본문 조각은 그대로 둔다 — 머리글·안내문·줄 기하는 전면 OCR 몫이다.
 */
async function sweepMarkerColumns(pngBuffer, items, sweepWorker, ranges, ocrScale) {
  if (ranges.length === 0) return;
  const meta = await sharp(pngBuffer).metadata();
  // 마커 바로 오른쪽 발문 글자는 최대한 배제하되, 세 자리 번호("100.")까지는 담기게.
  const STRIP_WIDTH_PT = 34;
  for (const [lo] of ranges) {
    const left = Math.max(0, Math.round((lo - 4) * ocrScale));
    const width = Math.min(Math.round(STRIP_WIDTH_PT * ocrScale), meta.width - left);
    if (width <= 0) continue;
    const strip = await sharp(pngBuffer)
      .extract({ left, top: 0, width, height: meta.height })
      .png()
      .toBuffer();
    const { data } = await sweepWorker.recognize(strip, {}, { blocks: true });
    const words = [];
    for (const b of data.blocks ?? [])
      for (const par of b.paragraphs ?? [])
        for (const l of par.lines ?? [])
          for (const w of l.words ?? []) words.push(w);

    const found = words
      .map((w) => ({ text: (w.text ?? "").trim(), bbox: w.bbox, confidence: w.confidence ?? 0 }))
      // 띠 안에는 마커 말고 읽힐 것이 거의 없으므로 전면 OCR 보다 문턱을 낮춘다 —
      // 스캔이 거친 회차에서 진짜 마커가 신뢰도 20~40 으로 나와 버려지고 있었다.
      // 문턱을 20 으로 낮춰도 인식률이 나아지지 않았다(실측: 53회 49개 그대로,
      // 59회는 49→48로 오히려 줄었다). 못 읽는 마커는 신뢰도가 낮은 게 아니라
      // 아예 안 읽히는 것이라 문턱과 무관하다 — 전면 OCR 과 같은 값을 쓴다.
      .filter((w) => /^\d{1,3}\.?$/.test(w.text) && w.confidence >= MARKER_MIN_CONFIDENCE);
    if (found.length === 0) continue;

    // **대체가 아니라 합집합이다.** 어느 쪽이 더 잘 읽는지가 회차마다 다르다
    // (실측: 61회는 띠 훑기가 6개를 더 찾았고, 74회는 반대로 전면 OCR 이 7개를 더
    // 찾았다). 대체로 두면 한쪽이 약한 회차에서 인식률이 통째로 떨어진다. 그래서
    // 같은 자리(같은 열, y 5pt 이내)에 이미 마커가 있으면 건드리지 않고, 없을 때만
    // 새로 채운다.
    const existing = items.filter((it) => {
      if (!isMarkerish(it)) return false;
      const x = it.transform[4];
      return x >= lo - 4 && x <= lo + STRIP_WIDTH_PT;
    });

    for (const w of found) {
      const x = (left + w.bbox.x0) / ocrScale;
      const yHere = (meta.height - w.bbox.y1) / ocrScale;
      if (existing.some((it) => Math.abs(it.transform[5] - yHere) <= 5)) continue;
      const yBottom = (meta.height - w.bbox.y1) / ocrScale;
      items.push({
        str: `${Number(w.text.replace(/\D/g, ""))}.`,
        transform: [1, 0, 0, 1, x, yBottom],
        width: (w.bbox.x1 - w.bbox.x0) / ocrScale,
        height: (w.bbox.y1 - w.bbox.y0) / ocrScale,
        confidence: w.confidence,
      });
    }
  }
}

/**
 * 본문 OCR 값과 숫자 전용 재인식 값 중 **읽기 순서와 맞는 쪽**을 고른다.
 *
 * 문항 번호는 지면의 읽기 순서(페이지 → 왼쪽 칼럼 → 오른쪽 칼럼, 각 칼럼 안에서는
 * 위에서 아래)로 1씩 늘어난다. 이 구조를 두 후보 중 하나를 고르는 데에만 쓴다 —
 * **없는 번호를 지어내지 않는다.** 둘 다 기대값과 다르면 손대지 않고 그대로 둔다
 * (그 문제지는 개수 검사에서 걸려 업로드가 막힌다). 실측 50회에서 이 규칙이 본문
 * OCR 의 15→18 오독과 재인식의 1→5 오독을 각각 상대편 값으로 바로잡았다.
 */
function chooseMarkerNumbers(pagesItems, ranges, expectedMarkerCount) {
  if (ranges.length === 0) return;
  // **열 순서는 x 로 정한다.** markerColumnRanges 는 촘촘한 순서(= 마커가 많은 열
  // 순서)로 돌려주므로 배열 순서를 그대로 읽기 순서로 쓰면 좌우가 뒤집힐 수 있다.
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  const columnOf = (x) => {
    const i = ordered.findIndex(([lo, hi]) => x >= lo && x <= hi);
    return i === -1 ? ordered.length : i;
  };
  const slots = [];
  pagesItems.forEach((items, pageIndex) => {
    const onPage = items
      .filter(isMarkerish)
      .map((it) => ({ it, x: it.transform[4], y: it.transform[5] }));
    onPage.sort((a, b) => {
      const colA = columnOf(a.x);
      const colB = columnOf(b.x);
      if (colA !== colB) return colA - colB;
      return b.y - a.y;
    });
    for (const s of onPage) slots.push({ ...s, page: pageIndex });
  });
  // 마커 자리 수가 문항 수와 정확히 같으면(빠진 것도 남는 것도 없음) 자리 자체가
  // 번호를 말한다 — 두 OCR 이 **둘 다** 틀린 자리(실측 50회 15번: 본문 OCR·재인식이
  // 모두 18로 읽어 5쪽의 진짜 18과 겹쳤다)까지 이때만 자리값으로 바로잡는다.
  // 자리 수가 다르면(마커를 놓쳤거나 잡음이 끼었으면) 자리와 번호가 어긋나므로
  // 절대 손대지 않는다.
  //
  // **자리 수가 맞는다고 무조건 믿으면 안 된다.** 가짜 마커를 몇 개 줍고 진짜를 몇 개
  // 놓쳐도 합이 우연히 같을 수 있는데, 그때 자리값으로 덮어쓰면 **번호가 통째로 밀린
  // 이미지**가 만들어진다(실측 61회: 7번 자리에 10번이 찍힌 이미지가 나왔다 — 다행히
  // 업로드 전 이미지 번호 대조에서 걸렸다). 그래서 "대체로 맞는데 몇 개만 어긋난"
  // 경우에만 자리값을 쓴다. 많이 어긋나면 자리 자체가 틀린 것이므로 손대지 않고,
  // 그 문제지는 개수/대조 게이트에서 막히게 둔다.
  const mismatchCount = slots.filter(
    (slot, i) => MARKERISH_RE.exec(slot.it.str)[1] !== String(i + 1),
  ).length;
  const trustPositions =
    expectedMarkerCount != null &&
    slots.length === expectedMarkerCount &&
    mismatchCount <= Math.max(2, Math.round(slots.length * 0.1));
  slots.forEach((slot, i) => {
    const expected = String(i + 1);
    const current = MARKERISH_RE.exec(slot.it.str)[1];
    if (current === expected) return;
    const alt = slot.it.alt ? MARKERISH_RE.exec(slot.it.alt)[1] : null;
    if (alt === expected || trustPositions) slot.it.str = `${expected}.`;
  });
  for (const slot of slots) delete slot.it.alt;
}

/**
 * PDF 전 쪽을 OCR 해서 pdfjs `getTextContent()` 모양의 결과를 페이지 순서로 돌려준다.
 *
 * @param pdf pdfjs 문서 (getPage/numPages)
 * @param worker tesseract.js 워커 (호출자가 만들고 끝나면 terminate 한다 — 워커
 *   기동에 언어 데이터 로딩이 붙어 문제지마다 새로 만들면 그만큼 느려진다)
 * @returns Array<{ items: Array<{ str, transform, width, height }> }>
 */
export async function buildOcrTextLayer(pdf, worker, { onPage, digitWorker, sweepWorker, expectedMarkerCount } = {}) {
  const pages = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const viewport = page.getViewport({ scale: OCR_SCALE });
    const canvas = createCanvas(viewport.width, viewport.height);
    await page.render({
      canvasContext: canvas.getContext("2d"),
      viewport,
      canvas,
    }).promise;

    const png = canvas.toBuffer("image/png");
    const { data } = await worker.recognize(png, {}, { blocks: true });

    const items = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          for (const word of line.words ?? []) {
            const text = (word.text ?? "").trim();
            if (!text) continue;
            const { x0, y0, x1, y1 } = word.bbox;
            items.push({
              str: normalizeMarkerish(text),
              // pdfjs 조각과 같은 규약: transform[4]=x, transform[5]=baseline y,
              // 좌표계 원점은 지면 왼쪽 아래. OCR 은 왼쪽 위 기준 상자를 주므로
              // 아래 변(y1)을 baseline 으로 본다(디센더만큼의 오차는 이 로직이
              // 쓰는 허용오차 안이다).
              transform: [1, 0, 0, 1, x0 / OCR_SCALE, (viewport.height - y1) / OCR_SCALE],
              width: (x1 - x0) / OCR_SCALE,
              confidence: word.confidence ?? 0,
              height: (y1 - y0) / OCR_SCALE,
            });
          }
        }
      }
    }
    if (digitWorker) await refineMarkers(png, items, digitWorker, OCR_SCALE);
    pages.push({ items, png });
    onPage?.(p, items.length);
  }
  const itemsByPage = pages.map((pg) => pg.items);

  // 1차(전면 OCR)로 마커 열이 어디인지 알아낸 다음, 그 띠만 숫자 전용으로 다시
  // 훑어 마커 목록을 새로 세운다. 전면 OCR 의 마커는 "열이 어디냐"를 정하는 데까지만
  // 쓰는 셈이다.
  if (sweepWorker) {
    const firstRanges = markerColumnRanges(itemsByPage);
    for (const page of pages)
      await sweepMarkerColumns(page.png, page.items, sweepWorker, firstRanges, OCR_SCALE);
  }

  const ranges = markerColumnRanges(itemsByPage);
  dropMarkersOutsideColumns(itemsByPage, ranges);
  chooseMarkerNumbers(itemsByPage, ranges, expectedMarkerCount);
  // 렌더 결과는 여기서 버린다 — 호출자에게는 글자 조각만 넘긴다.
  return pages.map(({ items }) => ({ items }));
}

/**
 * 원본 pdfjs 문서에 "이 텍스트 레이어를 쓰라"고 덧씌운 얇은 대역.
 * 렌더·뷰포트는 원본 페이지 그대로 가고 `getTextContent()` 만 갈아끼운다.
 */
export function withTextLayer(pdf, textLayerByPage) {
  return {
    numPages: pdf.numPages,
    async getPage(pageNumber) {
      const page = await pdf.getPage(pageNumber);
      const replacement = textLayerByPage[pageNumber - 1] ?? { items: [] };
      return new Proxy(page, {
        get(target, key) {
          if (key === "getTextContent") return async () => replacement;
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}
