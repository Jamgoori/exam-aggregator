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

// **OCR 상자의 아랫변은 baseline 이 아니다.** pdfjs 의 y 는 진짜 baseline 이라 g·쉼표
// 같은 디센더가 그 아래로 내려가는데, OCR 이 주는 상자의 아랫변은 그 줄 잉크의 맨
// 아래다. 그대로 baseline 이라고 넘기면 "본문 첫 줄이 속한 잉크 덩어리는 baseline
// 아래까지 이어진다"는 크롭 쪽 전제(crop-question-images.mjs 의 dropInkAboveBaseline)가
// 깨진다 — 그 줄이 baseline 위에서 끝나 버리므로 **머리글 잡음으로 몰려 통째로
// 지워진다**. 실측 78회: 50문항 중 36개가 발문 줄을 잃고 지문 상자부터 시작했다
// (개수 게이트는 통과하고 번호 대조 게이트에서 14/50 으로 걸렸다).
//
// 그래서 상자 아랫변에서 이만큼을 **글리프 안쪽으로 올려** baseline 으로 삼는다(진짜
// baseline 이 디센더 위에 있는 것과 같은 자리). 그러면 그 줄의 잉크가 baseline 아래로
// 내려가므로 위 전제가 성립한다. 같은 양을 height 에서 빼 두므로 "잉크 윗선"
// (y + height)은 변하지 않는다 — 크롭 경계 계산은 그대로 두고 baseline 의 의미만
// pdfjs 와 맞추는 것이다.
//
// **부호를 거꾸로 하면 더 나빠진다**(실측): baseline 을 아래로 내리면 덩어리가 그보다
// 더 아래까지 이어져야 살아남으므로, 멀쩡하던 줄까지 지워진다(78회 9번이 그렇게 죽었다).
//
// **비율(글자 높이의 %)로 옮기면 안 된다**(실측): 같은 줄이라도 글자 크기가 다르면
// 이동량이 달라져 크롭 쪽의 줄 묶기가 흐트러지고, 그러면 문항 아래 경계가 한 줄
// 위로 올라가 **마지막 선지가 통째로 잘린다**(78회 25번 ⑤가 그렇게 사라졌다).
// 고정값이라야 상대 기하가 그대로 보존된다. 글자가 이보다 작으면 높이의 40% 로 줄인다.
//
// **4pt 다.** 1.5pt 로 두었더니 잉크 아랫변 실측이 1~2pt 만 어긋나도(실측 59회 25번:
// 실측 440.8, 실제 443.0) baseline 이 잉크 밖으로 나가 발문 줄이 통째로 걷혔다.
// 4pt 면 10~14pt 글자의 몸통 안(x-height 구간)이라 그 정도 오차는 삼킨다. 줄 단위로
// 같은 값을 쓰므로 상대 기하는 그대로고, 잉크 윗선(y + height)도 변하지 않는다.
const DESCENDER_PT = 4;

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
 * 조각 하나가 서 있는 자리를 크게 잘라 **숫자만** 읽는다. refineMarkers(마커 재확인)와
 * rescueMissingMarkers(빠진 마커 재판독)가 같은 자르기를 쓴다 — 두 곳이 다르게 자르면
 * 한쪽에서만 옆 글자가 딸려 들어와 결과가 어긋난다.
 * @returns 읽힌 숫자 문자열(숫자 아닌 글자는 뺀 것). 못 읽으면 "".
 */
async function readSpotAsDigits(pngBuffer, item, digitWorker, ocrScale) {
  const x = item.transform[4] * ocrScale;
  // 조각의 baseline 은 상자 아랫변에서 DESCENDER_PT 만큼 글리프 안쪽으로 올려 둔 값이고
  // height 는 그만큼 줄어 있다(buildOcrTextLayer). 자를 상자는 그 이전의 상자여야 한다 —
  // 올린 값 그대로 자르면 숫자 아랫동강이 잘려 재판독이 틀린다(실측: DESCENDER_PT 를
  // 1.5→4 로 올리자 59회·65회 되살리기가 사라졌다).
  const yBottom = (item.transform[5] - DESCENDER_PT) * ocrScale;
  const h = (item.height + DESCENDER_PT) * ocrScale;
  const w = item.width * ocrScale;
  const pad = Math.round(h * 0.35);
  const meta = await sharp(pngBuffer).metadata();
  const left = Math.max(0, Math.round(x - pad));
  const top = Math.max(0, Math.round(meta.height - yBottom - h - pad));
  const width = Math.min(meta.width - left, Math.round(w + pad * 2));
  const height = Math.min(meta.height - top, Math.round(h + pad * 2));
  if (width <= 0 || height <= 0) return "";
  const crop = await sharp(pngBuffer)
    .extract({ left, top, width, height })
    .resize({ width: width * 3 })
    .png()
    .toBuffer();
  const { data } = await digitWorker.recognize(crop);
  const first = (data.text ?? "").replace(/[^\d]/g, "");
  if (first) return first;
  // 한 낱말 모드는 굵은 한 자리 번호에서 심심찮게 빈 결과를 낸다(실측 65회 7번: 같은
  // 상자를 SINGLE_WORD 3배로 읽으면 신뢰도 33 에서 흔들리다 빈 문자열, SINGLE_LINE 2배
  // + 흰 테두리 20px 로는 "7." 신뢰도 83). 비었을 때만 그 설정으로 한 번 더 읽는다.
  await digitWorker.setParameters({ tessedit_pageseg_mode: "7" }); // PSM.SINGLE_LINE
  try {
    const padded = await sharp(pngBuffer)
      .extract({ left, top, width, height })
      .resize({ width: width * 2 })
      .extend({ top: 20, bottom: 20, left: 20, right: 20, background: "#ffffff" })
      .png()
      .toBuffer();
    const { data: second } = await digitWorker.recognize(padded);
    return (second.text ?? "").replace(/[^\d]/g, "");
  } finally {
    await digitWorker.setParameters({ tessedit_pageseg_mode: "8" }); // PSM.SINGLE_WORD 복원
  }
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
  for (const item of candidates) {
    const read = await readSpotAsDigits(pngBuffer, item, digitWorker, ocrScale);
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
 * 회색조 래스터에서 [x0,x1]×[yFrom,yTo](px) 창 안의 **첫 잉크 띠 아랫행**을 찾는다.
 * 전면 OCR 조각과 띠 훑기 조각이 같은 규칙으로 잉크 아랫변을 잰다 — 한쪽만 재면 그쪽
 * 마커만 상자 아랫변(잉크보다 처진 값)을 쓰게 되어 발문이 걷힌다(실측 57회 11번:
 * 띠 훑기 조각이 아래 지문 상자 윗변까지 삼킨 23pt 상자였다).
 */
function inkBottomIn(gray, x0, x1, yFrom, yTo) {
    const { data: px, info } = gray;
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(info.width - 1, Math.ceil(x1));
    const lo = Math.max(0, Math.floor(yFrom));
    const hi = Math.min(info.height - 1, Math.ceil(yTo));
    if (hi < lo || right < left) return null;
    // **세로 실선 열은 빼고 본다.** 칼럼 사이 구분선이 낱말 상자 안에 걸치면(실측 59회
    // 25번 "25." — 구분선 x≈373~376 이 상자 x0 안쪽) 그 열은 창 전체가 잉크라 훑는
    // 즉시 창 맨 아래에서 "잉크"를 찾아 상자 아랫변을 그대로 돌려준다. 창 높이의
    // 90% 넘게 잉크인 열은 글자가 아니라 선이다.
    const rows = hi - lo + 1;
    const skip = new Uint8Array(right - left + 1);
    for (let x = left; x <= right; x++) {
      let n = 0;
      for (let y = lo; y <= hi; y++) if (px[y * info.width + x] < 160) n++;
      if (n >= rows * 0.9) skip[x - left] = 1;
    }
    // **위에서 내려오며 처음 만나는 잉크 띠의 아랫행**을 돌려준다. 아래에서 올라오며
    // 첫 잉크를 찾으면, 상자가 아래 요소까지 삼킨 낱말(실측 57회 11번 "11." — 높이
    // 23pt, 바로 밑 지문 상자 윗변까지 한 상자)에서 그 테두리 선을 아랫변으로 잡아
    // baseline 이 발문보다 12pt 아래로 가고 발문이 통째로 걷혔다. 글리프 몸통은
    // 상자 위쪽에서 시작하는 첫 띠다. 아래 요소·쉼표는 빈 행으로 갈려 안 섞인다.
    const rowHasInk = (y) => {
      const row = y * info.width;
      for (let x = left; x <= right; x++) if (!skip[x - left] && px[row + x] < 160) return true;
      return false;
    };
    let y = lo;
    while (y <= hi && !rowHasInk(y)) y++;
    if (y > hi) return null;
    while (y + 1 <= hi && rowHasInk(y + 1)) y++;
    return y;
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
  const gray = await sharp(pngBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
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

    // 이 띠 안에 세트 안내문("[29~30] …")이 서 있는 줄들. 아래에서 그 줄은 건너뛴다.
    //
    // 판정은 **"[N" 조각과 그 오른쪽 이웃 조각들을 이어 붙였을 때 "[N~M]" 이 되는가**로
    // 한다. 두 번 틀리고 정한 기준이다(실측 60회 11번 "11. (가)~(다)를 일어난 순서대로"):
    //   - "[" 로 시작하기만 하면 → 마커가 "[11" 처럼 읽힌 줄까지 안내문으로 몰림.
    //   - 같은 줄 어딘가에 물결표만 있으면 → 발문 속 "(가)~(다)" 의 물결표에 걸림.
    // 어느 쪽이든 그 자리를 채워 주던 띠 훑기가 막혀 11번이 통째로 사라졌다. 진짜
    // 안내문은 "[29" 바로 뒤에 "~30]" 이 붙는다.
    const GUIDE_RE = /^\[\s*\d{1,3}\s*[~∼～]\s*\d{1,3}\s*\]/;
    const guideLineYs = items
      .filter((it) => {
        if (!/^\[\s*\d{1,3}/.test(it.str)) return false;
        if (it.transform[4] < lo - 4 || it.transform[4] > lo + STRIP_WIDTH_PT) return false;
        const rightward = items
          .filter(
            (o) =>
              o !== it &&
              Math.abs(o.transform[5] - it.transform[5]) <= 5 &&
              o.transform[4] > it.transform[4],
          )
          .sort((a, b) => a.transform[4] - b.transform[4])
          .slice(0, 3);
        return GUIDE_RE.test([it, ...rightward].map((o) => o.str).join(""));
      })
      .map((it) => it.transform[5]);

    for (const w of found) {
      const x = (left + w.bbox.x0) / ocrScale;
      // 전면 OCR 조각과 같은 규약으로 맞춘다(디센더 몫만큼 내린 baseline).
      // 띠 좌표 → 지면 좌표(가로만 left 만큼 밀려 있다). 잉크 아랫변은 전면 OCR 과 같은 규칙.
      const measured = inkBottomIn(gray, left + w.bbox.x0, left + w.bbox.x1, w.bbox.y0, w.bbox.y1 + 3);
      const y1 = measured === null ? w.bbox.y1 : measured + 1;
      const heightPt = (y1 - w.bbox.y0) / ocrScale;
      const descender = Math.min(DESCENDER_PT, heightPt * 0.4);
      const yHere = (meta.height - y1) / ocrScale + descender;
      if (existing.some((it) => Math.abs(it.transform[5] - yHere) <= 5)) continue;
      // 세트 안내문("[29~30] 다음 자료를 …")이 서는 줄은 건너뛴다. 띠 안에서는 "[29" 의
      // 숫자만 보여 29. 로 읽히는데, 마커로 넣으면 진짜 29번과 겹치고(실측 61회 "29번이
      // 두 번") 안내문 줄에 "29" 가 하나 더 끼어 크롭 쪽 안내문 정규식까지 깨진다.
      if (guideLineYs.some((y) => Math.abs(y - yHere) <= 5)) continue;
      items.push({
        str: `${Number(w.text.replace(/\D/g, ""))}.`,
        transform: [1, 0, 0, 1, x, yHere],
        width: (w.bbox.x1 - w.bbox.x0) / ocrScale,
        height: heightPt - descender,
        confidence: w.confidence,
        // 띠 훑기가 만든 조각. 전면 OCR 이 같은 자리를 이미 글자로 갖고 있으므로,
        // 마커에서 내려갈 때는 마침표만 떼지 않고 조각째 지운다(demoteOutOfOrderMarkers).
        fromSweep: true,
      });
    }
  }
}

/** 읽기 순서(페이지 → 왼쪽 칼럼 → 오른쪽 칼럼, 칼럼 안에서는 위 → 아래) 비교용 키. */
function readingKey(page, columnIndex, y) {
  return [page, columnIndex, -y];
}

function compareKeys(a, b) {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * 읽기 순서에서 **번호가 거꾸로 가는 마커**를 마커 자리에서 내린다.
 *
 * 문항 번호는 읽기 순서(페이지 → 왼쪽 칼럼 → 오른쪽 칼럼, 칼럼 안에서는 위 → 아래)로
 * 반드시 1씩 늘어난다. 이 성질을 깨는 마커는 거의 전부 가짜다 — 실측 68회: 12쪽
 * 머리글의 "12" 가 마커 열 x 에 걸쳐 `"12."` 로 읽혀 12번 자리를 차지했다. 진짜 12번은
 * "빠진 번호"로 잡히지도 않았고(자리가 차 있으니), 13번은 앞뒤 번호가 뒤집혀 있어
 * 찾을 구간 자체가 없었다. 61회의 "29번이 두 번" 도 같은 부류다.
 *
 * 최장 증가 부분열(LIS)에 들지 못하는 마커를 내린다 — 가장 긴 사슬을 남기는 것이라
 * 진짜 마커 49개 사이에 낀 가짜 하나는 사슬에 못 든다. 내릴 때는 마침표만 떼서
 * (dropMarkersOutsideColumns 와 같은 방식) 조각의 위치 정보는 남긴다. 내려간 번호는
 * 이어지는 rescueMissingMarkers 가 "빠진 번호"로 다시 찾는다.
 */
function demoteOutOfOrderMarkers(pagesItems, ranges) {
  if (ranges.length === 0) return 0;
  const { slots } = markerSlotsInReadingOrder(pagesItems, ranges);
  if (slots.length < 2) return 0;

  // 엄격 증가 LIS — O(n log n), 되짚기용 prev 배열.
  const tailIndex = []; // tailIndex[k] = 길이 k+1 인 사슬의 마지막 slot 인덱스(끝 번호 최소)
  const prev = new Array(slots.length).fill(-1);
  for (let i = 0; i < slots.length; i++) {
    const n = slots[i].number;
    let lo = 0;
    let hi = tailIndex.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (slots[tailIndex[mid]].number < n) lo = mid + 1;
      else hi = mid;
    }
    prev[i] = lo > 0 ? tailIndex[lo - 1] : -1;
    tailIndex[lo] = i;
  }
  const keep = new Set();
  for (let i = tailIndex[tailIndex.length - 1]; i !== -1; i = prev[i]) keep.add(i);
  dbg(
    `LIS 전 순서: ${slots
      .map((s, i) => `${keep.has(i) ? "" : "✗"}${s.number}@p${s.pageIndex + 1}c${s.key[1]}y${(-s.key[2]).toFixed(0)}${s.it.fromSweep ? "s" : ""}`)
      .join(" ")}`,
  );

  let demoted = 0;
  slots.forEach((slot, i) => {
    if (keep.has(i)) return;
    // 띠 훑기 조각(fromSweep)도 지우지 않고 마침표만 뗀다. 지워 봤더니(실측 60회) 내려간
    // 띠 조각이 곧 되살리기의 유일한 후보였던 자리("11")가 비어 버렸다. 세트 안내문
    // 줄에 띠 조각이 끼는 문제는 sweepMarkerColumns 가 그 줄을 건너뛰는 것으로 막는다.
    slot.it.str = slot.it.str.slice(0, -1);
    delete slot.it.alt;
    demoted++;
  });
  return demoted;
}

/**
 * 마커 열 안에서 **버려지거나 잘못 읽힌 마커**를 되살린다.
 *
 * 실측(2026-09-12, 한능검 스캔본): 못 찾은 마커는 "아예 안 읽힌 것"이 아니었다.
 * 지면에서는 굵고 선명한데 OCR 결과가 마커 모양(`N.`)에 안 맞았을 뿐이다. 세 부류다:
 *
 *   (a) 번호는 읽혔는데 끝문자가 어긋남 — 79회 6번 `"6"`(마침표 미인식, 신뢰도 90),
 *       78회 7번 `"7),"`, 61회 `"13"`·`"14"`, 60·55회 `"11"`. `normalizeMarkerish` 는
 *       끝문자 한 개짜리만 되돌린다.
 *   (b) 숫자가 글자로 읽힘 — 79회 8번 `"Or"`. 텍스트로는 못 살린다. 그 자리를 잘라
 *       **숫자 전용으로 다시 읽으면** "8" 이 나온다(refineMarkers 와 같은 자르기).
 *       (a) 인데 신뢰도가 문턱 아래인 것(59회 50번 `"50"` 신뢰도 26)도 이 길로 보낸다 —
 *       재판독이 같은 번호를 내면 그것으로 확인된 것이다.
 *   (c) 있을 수 없는 번호로 읽힌 마커 — 61회 `"465."`(문항 수 50 인데). 재판독하면
 *       `"45."` 로, 빠진 번호와 정확히 맞는다.
 *
 * **규칙을 전역으로 풀면 안 된다** — 마커 열에는 선지 원문자(①~⑤)가 `"(3)"`, `"©"`
 * 처럼 읽힌 잡음이 함께 서 있어서, 숫자만 보고 주우면 가짜 마커가 섞인다(그 사고의
 * 결과가 "번호가 통째로 밀린 이미지"다 — 위 chooseMarkerNumbers 주석). 그래서 아래
 * 조건을 **모두** 만족하는 후보가 **정확히 하나**일 때만 되살린다:
 *
 *   1. 마커 열 안(열 폭에 8pt 여유 — 스캔본은 쪽마다 좌우로 몇 pt 씩 흔들려서, 61회는
 *      같은 칼럼의 마커 x 가 369·380·389 로 갈렸다)에 있고, 앞뒤 번호 사이의 읽기 순서
 *      자리에 있을 것.
 *   2. 읽힌 값이 **빠진 번호와 정확히 같을** 것 — (a)는 텍스트가 숫자로 시작해야
 *      하고(`"(3)"` 은 여는 괄호에서 걸러진다) 뒤 기호는 두 글자까지, (b)(c)는 재판독
 *      결과가 그 번호일 것.
 *   3. 선지 무리가 아닐 것 — 같은 열 45pt 안에 다른 조각이 둘 이상 있으면 선지
 *      묶음(①~⑤ 가 20pt 남짓 간격으로 선다)이라 보고 버린다. 마커는 발문 줄 하나뿐이라
 *      그렇게 촘촘히 서지 않는다. 재판독 경로에는 마커와 비슷한 글자 크기도 요구한다.
 *
 * 빠진 번호가 많은 회차(= 인식이 통째로 나쁜 회차)에는 손대지 않는다. 그런 문제지에서
 * 몇 개를 주워 개수만 맞추면 오히려 게이트를 통과해 버린다. 재판독 경로가 생기면서
 * 상한을 5→8로 올렸다 — 하나하나 글리프를 다시 읽어 확인하므로 추측이 아니다.
 * 업로드 전 두 게이트(개수 일치·찍힌 번호 대조)는 그대로다.
 */
const RESCUE_MAX_MISSING = 8;
const RESCUABLE_RE = /^(\d{1,3})[^\w\s]{0,2}$/;
const CHOICE_CLUSTER_PT = 45;
const RESCUE_COLUMN_SLACK_PT = 8;
// OCR_RESCUE_DEBUG=1 이면 되살리기 판단을 stderr 에 찍는다(왜 안 살아나는지 볼 때).
const RESCUE_DEBUG = Boolean(process.env.OCR_RESCUE_DEBUG);
const dbg = (...a) => RESCUE_DEBUG && console.error("[rescue]", ...a);

function markerSlotsInReadingOrder(pagesItems, ranges, slackPt = RESCUE_COLUMN_SLACK_PT) {
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  const columnOf = (x) => {
    const i = ordered.findIndex(([lo, hi]) => x >= lo - slackPt && x <= hi + slackPt);
    return i === -1 ? -1 : i;
  };
  const slots = [];
  pagesItems.forEach((items, pageIndex) => {
    for (const it of items) {
      if (!isMarkerish(it)) continue;
      const col = columnOf(it.transform[4]);
      slots.push({
        it,
        pageIndex,
        number: Number(MARKERISH_RE.exec(it.str)[1]),
        key: readingKey(pageIndex, col, it.transform[5]),
      });
    }
  });
  slots.sort((a, b) => compareKeys(a.key, b.key));
  return { slots, columnOf };
}

async function rescueMissingMarkers(pages, ranges, expectedMarkerCount, digitWorker, ocrScale) {
  if (ranges.length === 0 || expectedMarkerCount == null) return 0;
  const pagesItems = pages.map((pg) => pg.items);
  const { slots, columnOf } = markerSlotsInReadingOrder(pagesItems, ranges, RESCUE_COLUMN_SLACK_PT);

  const markerAt = new Map();
  const heights = [];
  for (const s of slots) {
    if (s.number > expectedMarkerCount) continue; // (c) 있을 수 없는 번호는 자리로 안 친다
    if (!markerAt.has(s.number)) markerAt.set(s.number, s.key);
    heights.push(s.it.height);
  }
  heights.sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 0;

  const missing = [];
  for (let n = 1; n <= expectedMarkerCount; n++) if (!markerAt.has(n)) missing.push(n);
  dbg(`빠진 번호 [${missing.join(",")}] 마커 ${markerAt.size} 열 ${ranges.map(([lo,hi])=>`${lo.toFixed(0)}~${hi.toFixed(0)}`).join(" ")}`);
  if (missing.length === 0 || missing.length > RESCUE_MAX_MISSING) return 0;

  // 같은 열에서 45pt 안에 **비슷한 크기의** 조각이 둘 이상 붙어 있으면 선지 묶음이다.
  //
  // 두 가지는 이웃으로 세지 않는다(실측으로 진짜 마커를 죽이던 것들):
  //   - 머리글·꼬리말 띠(지면 위아래 7%)의 조각. 칼럼 맨 위 마커(y≈976)는 바로 위
  //     머리글 "력"·"|"(y≈1010~1020)와 45pt 안에 있어, 68회 "12"·60회 "11"·61회
  //     "465"(재판독 45) 가 전부 선지 묶음으로 몰렸다.
  //   - 글자 크기가 후보의 60% 미만이거나 160% 초과인 조각. 스캔 잡음("^." h=1.9,
  //     "미조" h=4.8)이 이웃으로 잡혀 61회 9번("가"→재판독 9) 을 막았다. 선지 원문자는
  //     마커의 80% 남짓이라 그대로 걸린다.
  // 7.5%: 이 판형은 지면 높이 ≈1074pt, 칼럼 맨 위 마커 y≈977(91%), 머리글 조각
  // y≈1010~1021(94~95%). 5% 로 잡았더니 1019 의 머리글 "력" 이 띠 밖으로 새어 이웃으로
  // 세졌고(실측 60회 11번), 10% 면 마커 자리(977)까지 삼킨다. 그 사이 값.
  const HEADER_BAND = 0.075;
  const inBand = (y, pageHeightPt) =>
    Boolean(pageHeightPt) && (y > pageHeightPt * (1 - HEADER_BAND) || y < pageHeightPt * HEADER_BAND);
  const inChoiceCluster = (items, it, col, pageHeightPt) => {
    let neighbors = 0;
    for (const other of items) {
      if (other === it) continue;
      if (columnOf(other.transform[4]) !== col) continue;
      if (Math.abs(other.transform[5] - it.transform[5]) > CHOICE_CLUSTER_PT) continue;
      if (inBand(other.transform[5], pageHeightPt)) continue;
      // 위 한계 1.4: 칼럼 구분선 조각 "|"(h≈15.8, 마커의 1.5배)이 이웃으로 세지던 것
      // (실측 60회 11번). 선지 원문자는 마커의 0.8배 남짓이라 그대로 걸린다.
      const ratio = other.height / Math.max(it.height, 0.1);
      if (ratio < 0.6 || ratio > 1.4) continue;
      // 글자·숫자·원문자 흔적이 하나도 없는 조각(":" "|" "ㅣ" "]" 같은 것)은 이웃이
      // 아니다 — 칼럼 사이 세로 구분선이 마커 열 안(x≈367~376)에 걸쳐 지면 전체에
      // 그런 부스러기를 흘리고, 그것 둘만으로 진짜 마커가 선지 묶음으로 몰렸다(실측
      // 60회 11번: ":" ":" "|"). 선지 ①~⑤는 "©" "@" "(3)" "0)" 처럼 반드시 흔적이 남는다.
      if (!/[0-9A-Za-z가-힣①-⑳©®@()]/.test(other.str)) continue;
      neighbors++;
    }
    return neighbors >= 2;
  };
  // 0.4~2.0배: ±50% 로 두었더니 낱말 상자가 마커 글리프까지 삼켜 키가 큰 조각(61회 9번 "가"
  // — 상자 높이 17.8pt, 마커 중앙값 7.5pt)이 말없이 탈락했다. 부스러기·머리글은 3pt 바닥과
  // 띠 제외가 이미 거르므로 여기는 넓게 둔다. 재판독이 번호와 정확히 같아야 하는 건 그대로.
  const markerSized = (it) => {
    if (medianHeight <= 0) return false;
    const ratio = it.height / medianHeight;
    return ratio >= 0.4 && ratio <= 2.0;
  };

  // 앞뒤 경계는 **가장 가까운 있는 번호**로 잡는다. n-1 이 함께 빠져 있으면 n-2, n-3…
  // 으로 물러선다. 이게 없으면 12·13 이 같이 빠진 68회에서 12번의 뒤 경계가 없어져
  // 12쪽 머리글의 "12" 까지 후보로 들어왔다(후보 둘 → 손대지 않음 → 그대로 실패).
  const nearestBelow = (n) => {
    for (let k = n - 1; k >= 1; k--) if (markerAt.has(k)) return markerAt.get(k);
    return null;
  };
  const nearestAbove = (n) => {
    for (let k = n + 1; k <= expectedMarkerCount; k++) if (markerAt.has(k)) return markerAt.get(k);
    return null;
  };

  let rescued = 0;
  for (const n of missing) {
    const before = nearestBelow(n);
    const after = nearestAbove(n);
    if (!before && !after) continue;
    dbg(`${n}번: 앞 ${before ? JSON.stringify(before) : "없음"} 뒤 ${after ? JSON.stringify(after) : "없음"}`);

    const candidates = [];
    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const { items, png, heightPt } = pages[pageIndex];
      for (const it of items) {
        // 진짜 마커(범위 안 번호)는 후보가 아니다. 범위 밖 번호("465.")는 (c) 로 본다.
        if (isMarkerish(it) && Number(MARKERISH_RE.exec(it.str)[1]) <= expectedMarkerCount) continue;
        const col = columnOf(it.transform[4]);
        if (col === -1) continue;
        const key = readingKey(pageIndex, col, it.transform[5]);
        if (before && compareKeys(key, before) <= 0) continue;
        if (after && compareKeys(key, after) >= 0) continue;
        // 머리글·꼬리말 띠의 조각은 마커일 수 없다(쪽 번호 "12" 가 12번 후보로 들어오던 것).
        if (inBand(it.transform[5], heightPt)) {
          dbg(`  후보 탈락(머리글/꼬리말 띠) p${pageIndex + 1} y=${it.transform[5].toFixed(0)} "${it.str}"`);
          continue;
        }
        if (inChoiceCluster(items, it, col, heightPt)) {
          dbg(`  후보 탈락(선지 묶음) p${pageIndex + 1} y=${it.transform[5].toFixed(0)} "${it.str}"`);
          continue;
        }

        const m = RESCUABLE_RE.exec(it.str);
        if (m && Number(m[1]) === n && (it.confidence ?? 100) >= MARKER_MIN_CONFIDENCE) {
          candidates.push({ it, key, how: "text" });
          continue;
        }
        // 숫자로 읽혔는데 번호가 다르거나 신뢰도가 낮으면 버리지 않고 재판독으로 넘긴다 —
        // 61회 45번은 "465"(마침표까지 잃은 뒤) 로 읽혔고 재판독은 "45" 를 냈다.
        // (b)(c) 재판독 경로 — 글자 크기가 마커와 비슷한 조각만, 숫자 전용으로 다시 읽는다.
        if (!digitWorker || !png || !markerSized(it)) {
          if (m) dbg(`  후보 탈락(크기 h=${it.height.toFixed(1)}/${medianHeight.toFixed(1)}) p${pageIndex + 1} y=${it.transform[5].toFixed(0)} "${it.str}"`);
          continue;
        }
        if (/^\(/.test(it.str)) continue; // 선지 "(3)" 모양은 애초에 안 본다
        const read = await readSpotAsDigits(png, it, digitWorker, ocrScale);
        if (read !== String(n)) {
          if (m || read) dbg(`  후보 탈락(재판독 "${read}") p${pageIndex + 1} y=${it.transform[5].toFixed(0)} "${it.str}"`);
          continue;
        }
        candidates.push({ it, key, how: "reread" });
      }
    }
    dbg(`  후보 ${candidates.length}개: ${candidates.map((c) => `${c.how} "${c.it.str}" ${JSON.stringify(c.key)}`).join(" | ")}`);
    if (candidates.length === 0 && digitWorker && n > 5) {
      // (d) 조각이 아예 없는 자리 — 두 OCR 패스가 그 낱말을 하나도 내놓지 않은 경우
      // (실측 65회 7번, 64회 20번: 지면에는 또렷한데 조각 0개). 앞뒤 번호 사이의 마커
      // 띠만 3배로 키워 숫자 전용으로 다시 읽고, 빠진 번호와 **정확히** 같은 낱말이
      // 하나뿐일 때만 그 자리에 마커를 만든다. 1~5 는 선지 원문자와 헷갈릴 수 있어
      // 이 길로는 안 만든다.
      const found = await rereadGapForNumber(pages, ranges, before, after, n, digitWorker, ocrScale, columnOf);
      if (found) {
        markerAt.set(n, found.key);
        rescued++;
        dbg(`  띠 재판독으로 되살림: p${found.key[0] + 1} y=${(-found.key[2]).toFixed(0)}`);
      }
      continue;
    }
    if (candidates.length !== 1) continue;
    candidates[0].it.str = `${n}.`;
    candidates[0].it.confidence = Math.max(candidates[0].it.confidence ?? 0, MARKER_MIN_CONFIDENCE);
    markerAt.set(n, candidates[0].key);
    rescued++;
  }
  return rescued;
}

/**
 * 앞뒤 번호 사이의 마커 띠에서 **픽셀로** 글리프를 찾아 빠진 번호를 읽는다(rescueMissingMarkers (d)).
 *
 * OCR 로 띠를 다시 읽는 방식은 안 됐다(실측 65회 7번: 지면에 또렷한 "7." 을 전면 OCR·
 * 띠 훑기·3배 확대 재판독 모두 낱말로 내놓지 않았고, 띠를 토막 내면 아무것도 안 읽는다).
 * 그래서 띠 안의 세로 잉크 덩어리를 직접 찾아 마커 글리프 크기(8~22pt)인 것만 골라
 * 한 덩어리씩 숫자 전용으로 읽는다.
 *
 * 훑을 구간: 앞 번호와 뒤 번호가 같은 쪽·같은 열이면 그 사이. 열이나 쪽이 바뀌면
 * 앞 번호 아래(그 열 끝까지)와 뒤 번호 위(그 열 처음부터) 두 토막.
 * @returns { key } 만든 마커의 읽기 순서 키. 못 찾거나 둘 이상이면 null.
 */
async function rereadGapForNumber(pages, ranges, before, after, n, digitWorker, ocrScale, columnOf) {
  const ordered = [...ranges].sort((a, b) => a[0] - b[0]);
  // 마커 글리프가 서는 띠: 열 범위(lo~hi) 왼쪽 4pt 앞부터 오른쪽 12pt 뒤까지. 열 범위는
  // 쪽마다 흔들리는 마커 x 를 담은 것이라(64회: 373~389, "20." 은 389 에서 시작) 왼쪽
  // 끝 기준 고정 폭으로 자르면 오른쪽에 선 마커를 놓친다(실측 64회 20번). 선지 원문자
  // (①~⑤)가 띠에 걸려도 재판독 값이 빠진 번호와 같아야만 하므로 해가 없다.
  const BAND_LEFT_PT = 4;
  const BAND_RIGHT_PT = 12;
  const MIN_H_PT = 8;
  const MAX_H_PT = 22;
  const segments = [];
  const pageHeightOf = (i) => pages[i].heightPt ?? 0;
  if (before && after && before[0] === after[0] && before[1] === after[1]) {
    segments.push({ page: before[0], col: before[1], yTop: -before[2] - 2, yBottom: -after[2] + 4 });
  } else {
    if (before && before[1] >= 0 && before[1] < ordered.length)
      segments.push({ page: before[0], col: before[1], yTop: -before[2] - 2, yBottom: pageHeightOf(before[0]) * 0.05 });
    if (after && after[1] >= 0 && after[1] < ordered.length)
      segments.push({ page: after[0], col: after[1], yTop: pageHeightOf(after[0]) * 0.93, yBottom: -after[2] + 4 });
  }

  const hits = [];
  for (const seg of segments) {
    const { png, items, heightPt } = pages[seg.page];
    if (!png || !heightPt || seg.yTop - seg.yBottom < 8) continue;
    const [lo, hi] = ordered[seg.col];
    dbg(`  띠 탐색 p${seg.page + 1} 열${seg.col}(${lo.toFixed(0)}~${hi.toFixed(0)}) y ${seg.yTop.toFixed(0)}→${seg.yBottom.toFixed(0)}`);
    const { data: px, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const left = Math.max(0, Math.round((lo - BAND_LEFT_PT) * ocrScale));
    const right = Math.min(info.width - 1, Math.round((hi + BAND_RIGHT_PT) * ocrScale));
    const top = Math.max(0, Math.round((heightPt - seg.yTop) * ocrScale));
    const bottom = Math.min(info.height - 1, Math.round((heightPt - seg.yBottom) * ocrScale));
    if (right <= left || bottom <= top) continue;

    // 띠 안에서 세로로 이어진 잉크 덩어리(행 구간)를 찾는다. 마커 글리프 높이만 남긴다.
    //
    // **세로 선이 든 열은 빼고 센다.** 칼럼 구분선·지문 상자 테두리가 띠에 걸치면 구간
    // 전체가 한 덩어리(실측 64회 p5: h=602.8pt)가 되어 마커 크기 덩어리가 나올 수 없다.
    // 구간 높이의 절반 넘게 잉크인 열은 글자가 아니다.
    const segRows = bottom - top + 1;
    const skipCol = new Uint8Array(right - left + 1);
    for (let x = left; x <= right; x++) {
      let n = 0;
      for (let y = top; y <= bottom; y++) if (px[y * info.width + x] < 160) n++;
      if (n >= segRows * 0.5) skipCol[x - left] = 1;
    }
    const rowHasInk = (y) => {
      const row = y * info.width;
      for (let x = left; x <= right; x++) if (!skipCol[x - left] && px[row + x] < 160) return true;
      return false;
    };
    let y = top;
    while (y <= bottom) {
      while (y <= bottom && !rowHasInk(y)) y++;
      if (y > bottom) break;
      const start = y;
      while (y <= bottom && rowHasInk(y)) y++;
      const end = y - 1;
      const hPt = (end - start + 1) / ocrScale;
      if (hPt < MIN_H_PT || hPt > MAX_H_PT) {
        dbg(`  띠 덩어리(크기 제외) p${seg.page + 1} y=${((info.height - (end + 1)) / ocrScale).toFixed(0)} h=${hPt.toFixed(1)}`);
        continue;
      }
      // **덩어리의 왼쪽 끝이 마커 열 안에 있어야 한다.** 띠를 열 오른쪽 12pt 까지 넓히자
      // (64회 "20." 이 열 오른쪽 끝에 섰다) 선지 원문자(열보다 18pt 오른쪽)가 띠에 걸려
      // 덩어리로 잡히고, 숫자 전용 판독이 ①·④·⑤ 를 "7" 로 읽어 진짜 7 이 유일하지 않게
      // 됐다(실측 65회 7번). 마커는 열 왼쪽에 서고 원문자는 열 밖에서 시작한다.
      let leftmost = Infinity;
      for (let yy = start; yy <= end; yy++) {
        const row = yy * info.width;
        for (let x = left; x <= right; x++)
          if (!skipCol[x - left] && px[row + x] < 160) {
            if (x < leftmost) leftmost = x;
            break;
          }
      }
      // hi+1: 원문자는 열 오른쪽 끝 바로 밖(실측 65회 x=60, hi=58)에 서서 +2 로는 못 갈랐다.
      if (leftmost / ocrScale > hi + 1) {
        dbg(`  띠 덩어리(열 밖 시작 x=${(leftmost / ocrScale).toFixed(0)}) p${seg.page + 1} y=${((info.height - (end + 1)) / ocrScale).toFixed(0)} h=${hPt.toFixed(1)}`);
        continue;
      }
      // 이 덩어리만 넉넉히 잘라 숫자 전용(한 낱말)으로 읽는다 — readSpotAsDigits 와 같은 규약.
      // readSpotAsDigits 는 baseline·height 에 DESCENDER_PT 가 반영된 조각을 기대한다.
      // 자를 폭은 **덩어리 왼쪽 끝에서 16pt** — 띠 전체를 넘기면 발문 첫 글자까지 들어와
      // "7." 이 "73" 으로 읽혔다(실측 65회). 세 자리 번호+마침표가 14pt 남짓이다.
      const item = {
        str: "",
        transform: [1, 0, 0, 1, leftmost / ocrScale - 1, (info.height - (end + 1)) / ocrScale + DESCENDER_PT],
        width: 16,
        height: hPt - DESCENDER_PT,
      };
      const read = await readSpotAsDigits(png, item, digitWorker, ocrScale);
      dbg(`  띠 덩어리 p${seg.page + 1} y=${((info.height - (end + 1)) / ocrScale).toFixed(0)} h=${hPt.toFixed(1)} → 재판독 "${read}"`);
      if (read !== String(n)) continue;
      hits.push({
        seg,
        items,
        item: {
          str: `${n}.`,
          transform: [1, 0, 0, 1, leftmost / ocrScale, (info.height - (end + 1)) / ocrScale + DESCENDER_PT],
          width: 16,
          height: hPt - DESCENDER_PT,
          confidence: MARKER_MIN_CONFIDENCE,
          fromSweep: true,
        },
      });
    }
  }
  if (hits.length !== 1) return null;
  const hit = hits[0];
  hit.items.push(hit.item);
  return { key: readingKey(hit.seg.page, columnOf(hit.item.transform[4]), hit.item.transform[5]) };
}

/**
 * 같은 번호가 두 번 읽힌 자리를 읽기 순서로 바로잡는다.
 *
 * demoteOutOfOrderMarkers 가 먼저 돌아 대부분의 중복은 이미 한쪽이 내려가 있다. 여기
 * 남는 것은 "두 마커가 순서상 둘 다 말이 되는" 경우뿐이다(28, 29, 29, 30 에서 어느
 * 29 도 사슬을 안 깨는 일은 없으니 실제로는 드물다). 재판독(refineMarkers)이 후보(alt)를
 * 달아 두었으면 그것을 먼저 쓰고, 없으면 **앞뒤 번호가 정확히 가리키는 빠진 번호**일
 * 때만 바꾼다. 그 밖의 경우는 손대지 않는다(개수 게이트가 막는다).
 */
function resolveDuplicateMarkers(pagesItems, ranges, expectedMarkerCount) {
  if (ranges.length === 0 || expectedMarkerCount == null) return 0;
  const { slots } = markerSlotsInReadingOrder(pagesItems, ranges);
  dbg(`마커 순서: ${slots.map((s) => `${s.number}@p${s.key[0] + 1}c${s.key[1]}y${(-s.key[2]).toFixed(0)}`).join(" ")}`);
  const present = new Set(slots.map((s) => s.number));
  let fixed = 0;
  for (let i = 1; i < slots.length; i++) {
    const a = slots[i - 1];
    const b = slots[i];
    if (a.number !== b.number) continue;
    const altB = b.it.alt ? Number(MARKERISH_RE.exec(b.it.alt)[1]) : null;
    const altA = a.it.alt ? Number(MARKERISH_RE.exec(a.it.alt)[1]) : null;
    const next = slots[i + 1]?.number ?? expectedMarkerCount + 1;
    const prev = slots[i - 2]?.number ?? 0;
    const wantB = a.number + 1;
    const wantA = b.number - 1;
    if (!present.has(wantB) && wantB < next && (altB === wantB || altB === null)) {
      b.it.str = `${wantB}.`;
      b.number = wantB;
      present.add(wantB);
      fixed++;
    } else if (!present.has(wantA) && wantA > prev && (altA === wantA || altA === null)) {
      a.it.str = `${wantA}.`;
      a.number = wantA;
      present.add(wantA);
      fixed++;
    }
  }
  return fixed;
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
  // 열 판정에 되살리기와 같은 여유를 준다 — 되살아난 마커는 열 폭 밖 8pt 까지 있을 수
  // 있어서(68회 12·13번 x≈389.4, 열 373~389), 여유 없이 보면 "열 밖" 으로 밀려 자리가
  // 흐트러진다.
  const columnOf = (x) => {
    const i = ordered.findIndex(
      ([lo, hi]) => x >= lo - RESCUE_COLUMN_SLACK_PT && x <= hi + RESCUE_COLUMN_SLACK_PT,
    );
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
 * @param onRescue (되살린 마커 수, 중복 바로잡은 수, 순서 어긋나 내린 수). 모두 0 이면
 *   부르지 않는다. (rescueMissingMarkers / resolveDuplicateMarkers / demoteOutOfOrderMarkers)
 * @returns Array<{ items: Array<{ str, transform, width, height }> }>
 */
export async function buildOcrTextLayer(
  pdf,
  worker,
  { onPage, onRescue, digitWorker, sweepWorker, expectedMarkerCount } = {},
) {
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
    // 줄의 **진짜 잉크 아랫변**을 재기 위한 회색조 래스터. tesseract 의 낱말 상자 아랫변은
    // 실제 잉크보다 몇 pt 아래로 처지는 일이 있어(실측 59회 25번: 상자 아랫변 440.0,
    // 잉크 아랫변 ≈444) 그 값을 baseline 으로 넘기면 크롭 쪽 dropInkAboveBaseline 이
    // "이 줄은 baseline 위에서 끝난다"고 보고 발문 줄을 통째로 걷어낸다. 고정 1.5pt
    // 들어올리기로는 못 넘는 오차라, 상자 근처를 직접 훑어 잉크가 끝나는 행을 쓴다.
    const gray = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const inkBottomPx = (x0, x1, yFrom, yTo) => inkBottomIn(gray, x0, x1, yFrom, yTo);

    const items = [];
    for (const block of data.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        for (const line of paragraph.lines ?? []) {
          // **한 줄의 낱말은 baseline 을 하나로 맞춘다.** pdfjs 는 한 run 에 baseline 이
          // 하나인데, OCR 상자 아랫변은 낱말마다 몇 pt 씩 흔들린다(실측 61회 7쪽 세트
          // 안내문 "[29~30] 다음 자료를 …": "[29"·"~30]" 은 976, "다음" 977, "료" 973).
          // 크롭 쪽은 y 를 정수로 반올림해 줄을 묶으므로 이 한 줄이 세 줄로 갈라지고,
          // 안내문을 한 줄에서 직접 맞춘 뒤 **이웃 줄 다시 엮기가 같은 안내문을 한 번
          // 더 등록**해 세트가 두 번 만들어졌다("29번이 두 번 잘렸습니다").
          //
          // 줄 안 낱말 아랫변의 중앙값을 그 줄의 아랫변으로 쓰되, 4pt 넘게 벗어난 낱말
          // (머리글의 큰 글자 등)은 제 값을 지킨다 — 최댓값으로 맞추면 그런 낱말 하나가
          // 줄 전체를 끌어내려 띠 훑기의 같은 자리 판정(5pt)까지 어긋난다. 아랫변만
          // 옮기고 윗변은 그대로 두므로 "잉크 윗선"(y + height)은 낱말마다 변하지 않는다.
          // 낱말마다 **제 x 범위 안에서** 잉크가 끝나는 행을 잰다(상자 아랫변에서 위로 글자
          // 높이의 60%, 아래로 3px). 줄 전체 x 범위로 재면 안 된다 — 발문 바로 아래 말풍선의
          // 점선 윗변이 그 범위에 걸려 "잉크 아랫변"으로 잡히고, 상자가 9pt 처진 줄(59회
          // 25번)이 그대로 남아 발문이 걷혀 나갔다. 마커 "25." 의 x 범위(380~400)에는
          // 말풍선이 없으니 낱말별로 재면 제값이 나온다. 줄의 아랫변은 그 중앙값.
          // 낱말별 실측 아랫변(상자 윗변부터 아랫변 3px 아래까지 창; 첫 잉크 띠를 위에서 찾는다).
          const measuredByWord = new Map();
          for (const w of line.words ?? []) {
            if (!(w.text ?? "").trim()) continue;
            const m = inkBottomPx(w.bbox.x0, w.bbox.x1, w.bbox.y0, w.bbox.y1 + 3);
            measuredByWord.set(w, m === null ? w.bbox.y1 : m + 1); // 잉크 마지막 행 바로 아래 = 아랫변
          }
          const measuredBottoms = [...measuredByWord.values()].sort((a, b) => a - b);
          const lineBottom = measuredBottoms.length
            ? measuredBottoms[Math.floor(measuredBottoms.length / 2)]
            : null;
          // 6pt: 상자 아랫변이 잉크보다 4~5pt 처진 낱말(위 59회 25번)까지 실측값으로 끌어와야
          // 한다. 그보다 더 벗어난 낱말(머리글의 큰 글자 등)은 제 값을 지킨다.
          const SNAP_PX = 6 * OCR_SCALE;

          for (const word of line.words ?? []) {
            const text = (word.text ?? "").trim();
            if (!text) continue;
            // **글자·숫자·원문자 흔적이 없는 부스러기는 넣지 않는다.** 칼럼 사이 세로
            // 구분선·지문 상자 테두리가 ":" "|" "ㅣ" "]" "." 같은 조각으로 지면 곳곳에
            // 읽히는데, 크롭 쪽은 이것도 "줄"로 세어 줄간격 중앙값이 몇 pt 로 내려앉는다.
            // 그러면 꼬리말 판정(본문과 줄간격의 2.1배 넘게 떨어진 한두 줄)이 마지막
            // 선지 줄에 걸려, 칼럼 마지막 문항의 ⑤ 가 꼬리말로 잘려 나갔다(실측 69회 2번).
            // 되살리기의 선지 묶음 판정도 같은 부스러기에 흔들렸다(60회 11번).
            if (!/[0-9A-Za-z가-힣ㄱ-ㅎ①-⑳⑴-⒇©®@()\[\]~∼～]/.test(text)) continue;
            // 높이 3pt 미만은 글자가 아니라 글리프 윗동강·얼룩이다(실측 59회 25번: 발문 줄
            // 11pt 위에 h=1.4~1.6 짜리 "ao" "vo]" "mall" 이 따로 읽혀 가짜 줄이 되고, 그
            // 줄이 크롭 위 경계를 흐트러뜨려 발문이 통째로 빠졌다). 본문 글자는 5pt 넘는다.
            if ((word.bbox.y1 - word.bbox.y0) / OCR_SCALE < 3) continue;
            const { x0, y0, x1 } = word.bbox;
            // **비교도 실측값끼리.** 상자 아랫변과 비교하면, 상자가 12pt 처진 낱말(실측 57회 11번
            // "11." — 밑은 흰 여백인데 상자 높이 27pt)은 6pt 밖이라 "제 값을 지킨다"며 그
            // 나쁜 상자 아랫변으로 돌아가 발문이 걷혔다. 안 붙는 낱말도 제 실측값을 쓴다.
            const own = measuredByWord.get(word) ?? word.bbox.y1;
            const y1 = lineBottom !== null && Math.abs(own - lineBottom) <= SNAP_PX ? lineBottom : own;
            // pdfjs 조각과 같은 규약: transform[4]=x, transform[5]=baseline y,
            // 좌표계 원점은 지면 왼쪽 아래. OCR 은 왼쪽 위 기준 상자를 주므로 아래
            // 변(y1)에서 디센더 몫만큼 글리프 안쪽으로 올려 baseline 으로 삼는다(위 DESCENDER_PT).
            const heightPt = (y1 - y0) / OCR_SCALE;
            const descender = Math.min(DESCENDER_PT, heightPt * 0.4);
            items.push({
              str: normalizeMarkerish(text),
              transform: [
                1,
                0,
                0,
                1,
                x0 / OCR_SCALE,
                (viewport.height - y1) / OCR_SCALE + descender,
              ],
              width: (x1 - x0) / OCR_SCALE,
              confidence: word.confidence ?? 0,
              height: heightPt - descender,
            });
          }
        }
      }
    }
    if (digitWorker) await refineMarkers(png, items, digitWorker, OCR_SCALE);
    // heightPt: 되살리기가 머리글·꼬리말 띠를 가려내는 데 쓴다(rescueMissingMarkers).
    pages.push({ items, png, heightPt: viewport.height / OCR_SCALE });
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
  // 끝문자가 어긋나 버려진 마커를 좁은 조건으로만 되살린다(위 주석). 되살린 뒤에
  // 번호를 고르므로, 되살아난 자리도 읽기 순서 검사를 그대로 받는다.
  // 읽기 순서를 거스르는 가짜 마커(머리글의 쪽 번호 등)를 먼저 내려야, 그 번호가 "빠진
  // 번호"로 잡혀 진짜 자리를 찾는다(demoteOutOfOrderMarkers 주석의 68회).
  const demoted = demoteOutOfOrderMarkers(itemsByPage, ranges);
  const rescued = await rescueMissingMarkers(pages, ranges, expectedMarkerCount, digitWorker, OCR_SCALE);
  // 같은 번호가 두 번 읽힌 자리는 되살리기 뒤에 본다 — 되살아난 마커가 앞뒤 번호를
  // 채워 줘야 "정확히 가리키는 빠진 번호"를 판정할 수 있다.
  const deduped = resolveDuplicateMarkers(itemsByPage, ranges, expectedMarkerCount);
  if (rescued || deduped || demoted) onRescue?.(rescued, deduped, demoted);
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
