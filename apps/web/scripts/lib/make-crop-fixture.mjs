// 크롭 로직 테스트용 합성 PDF 생성기.
//
// 실제 문제지 PDF 는 저장소에 없고(용량·저작권) Supabase 에서 받아야 하므로,
// 실측에서 보고된 조판 결함을 그대로 재현한 PDF 를 코드로 만들어 회귀를 막는다.
// 재현 대상:
//   - 지면을 감싸는 테두리 실선 + 칼럼 구분 실선 → 문항 이미지 좌·우에 남던 실선
//   - 첫 본문 줄에 바싹 붙은 되풀이 머리글(과목명) + 그 아래 가로 괘선
//   - 되풀이 꼬리말(쪽번호)
//   - 공통지문 세트(한 칼럼 안 / 페이지를 넘는 것)
//   - 지시문 재사용형 세트(안내문 바로 아래 첫 문항)
//
// pdf-lib 의 표준 폰트(Helvetica)만 쓴다 — 한글 폰트 파일을 저장소에 두지 않으려는
// 것. 마커 정규식("1.")·안내문 정규식("[3~4]")은 아스키로도 그대로 걸리므로
// 레이아웃 회귀 검사에는 충분하다.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const PAGE_W = 595;
const PAGE_H = 842;

// 지면 테두리·칼럼 구분선 굵기(실측 조판이 쓰는 정도).
const RULE_W = 0.8;

const BODY_SIZE = 9;
const LEAD = 13;

export const FIXTURE_LAYOUT = {
  pageWidth: PAGE_W,
  pageHeight: PAGE_H,
  borderLeftX: 22,
  borderRightX: PAGE_W - 22,
  columnRuleX: 297.5,
  leftTextX: 40,
  rightTextX: 312,
  columnTextWidth: 240,
  headerY: 800,
  headerRuleY: 788,
  footerY: 34,
  bodyTopY: 770,
};

// 문항마다 **다른 문구**를 쓴다. 되풀이 머리글 감지는 숫자를 뭉개고 글자 내용을
// 비교하므로, 문항 본문이 번호만 다른 같은 문장이면 본문 줄이 머리글로 오인된다 —
// 실제 문제지에는 없는 픽스처만의 함정이라 여기서 피한다.
const TOPICS = [
  "the administrative appeal system and its limits",
  "vowel harmony in fifteenth century orthography",
  "the separation of powers under the constitution",
  "photosynthesis rates across broad leaf surfaces",
  "trade routes of the late Goryeo period",
  "recursive descent parsing of arithmetic grammars",
  "the burden of proof in criminal procedure",
  "tidal patterns along the southern coastline",
  "monetary policy passed through bank lending",
  "soil salinity control in reclaimed farmland",
  "the doctrine of legitimate expectation",
  "seismic wave propagation through the mantle",
];

const topic = (n) => TOPICS[(n - 1) % TOPICS.length];

// 칼럼 폭을 넘지 않게 자른다. 픽스처가 칼럼 밖으로 삐져나오면 한 텍스트 조각이 두
// 칼럼에 걸쳐 칼럼 분류 자체가 현실과 달라진다.
function fit(font, text, size, maxWidth) {
  let out = text;
  while (out.length > 1 && font.widthOfTextAtSize(out, size) > maxWidth) out = out.slice(0, -1);
  return out;
}

function drawFrame(page, font, { frame, header, footer }) {
  const L = FIXTURE_LAYOUT;
  if (frame) {
    page.drawRectangle({
      x: L.borderLeftX,
      y: 20,
      width: L.borderRightX - L.borderLeftX,
      height: PAGE_H - 40,
      borderWidth: RULE_W,
      borderColor: rgb(0, 0, 0),
    });
    page.drawLine({
      start: { x: L.columnRuleX, y: 26 },
      end: { x: L.columnRuleX, y: PAGE_H - 26 },
      thickness: RULE_W,
      color: rgb(0, 0, 0),
    });
  }
  if (header) {
    page.drawText(header.left, { x: L.leftTextX, y: L.headerY, size: 10, font });
    page.drawText(header.right, { x: 470, y: L.headerY, size: 10, font });
    page.drawLine({
      start: { x: L.borderLeftX + 4, y: L.headerRuleY },
      end: { x: L.borderRightX - 4, y: L.headerRuleY },
      thickness: RULE_W,
      color: rgb(0, 0, 0),
    });
  }
  if (footer) page.drawText(footer, { x: 250, y: L.footerY, size: 9, font });
}

// 한 칼럼에 문항/지문을 위에서 아래로 흘려 넣는 커서.
function columnCursor(page, font, x, topY) {
  let y = topY;
  return {
    get y() {
      return y;
    },
    line(text, opts = {}) {
      const indent = opts.indent ?? 0;
      const size = opts.size ?? BODY_SIZE;
      page.drawText(fit(font, text, size, FIXTURE_LAYOUT.columnTextWidth - indent), {
        x: x + indent,
        y,
        size,
        font,
      });
      y -= opts.lead ?? LEAD;
    },
    gap(pt) {
      y -= pt;
    },
    // 테두리 상자 안에 지문을 넣는다. 상자는 테두리 때문에 잉크 한 덩어리가 된다.
    box(lines) {
      const top = y + 4;
      const height = lines.length * LEAD + 16;
      page.drawRectangle({
        x: x + 6,
        y: top - height,
        width: FIXTURE_LAYOUT.columnTextWidth - 12,
        height,
        borderWidth: RULE_W,
        borderColor: rgb(0, 0, 0),
      });
      let ty = top - 14;
      for (const t of lines) {
        page.drawText(fit(font, t, BODY_SIZE, FIXTURE_LAYOUT.columnTextWidth - 28), {
          x: x + 14,
          y: ty,
          size: BODY_SIZE,
          font,
        });
        ty -= LEAD;
      }
      y = top - height - LEAD;
    },
  };
}

// 한 문항이 만드는 잉크 줄(=이미지에서 잉크 덩어리) 수.
export const LINES_PER_QUESTION = 6;

function question(cursor, number, { bodyLines = 1 } = {}) {
  cursor.line(`${number}. Which of the following best describes ${topic(number)}?`);
  for (let i = 0; i < bodyLines; i++) {
    cursor.line(`   Remark ${i + 1} on ${topic(number + i + 1)}.`);
  }
  for (let c = 1; c <= 4; c++) cursor.line(`(${c}) ${topic(number + c)}`, { indent: 6 });
  cursor.gap(9);
}

function passage(cursor, from, to, lineCount) {
  cursor.line(`[${from}~${to}] Read the passage below and answer the questions.`);
  cursor.box(
    Array.from({ length: lineCount }, (_, i) => `Line ${i + 1} of the passage for ${from} to ${to}.`),
  );
}

// 2쪽·2단 픽스처.
//   1번,2번          — 1쪽 좌단 일반 문항 (2번은 머리글 바로 아래가 아님)
//   [3~4]            — 1쪽 좌단 공통지문 세트 (한 칼럼 안)
//   5번,6번          — 1쪽 우단 일반 문항
//   [7~8]            — 1쪽 우단 안내문·지문·7번, 2쪽 좌단 8번 (페이지를 넘는 세트)
//   [9~10]           — 2쪽 좌단 지시문 재사용형 세트 (안내문 바로 아래 첫 문항)
//   11번             — 2쪽 우단, 칼럼의 마지막 문항 (아래가 꼬리말)
//
// opts.frame=false 로 테두리·구분선 없는 조판을 만든다 — 실선 제거 로직이 실선
// 없는 문제지를 건드리지 않는지 확인하는 대조군이다.
export async function buildFixturePdf({ frame = true, header = true, footer = true } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const L = FIXTURE_LAYOUT;
  const frameOpts = (n) => ({
    frame,
    header: header ? { left: "KOREAN 25MUN", right: "TYPE A" } : null,
    footer: footer ? `KOREAN 23 - ${n}` : null,
  });

  const p1 = pdf.addPage([PAGE_W, PAGE_H]);
  drawFrame(p1, font, frameOpts(1));
  const p1L = columnCursor(p1, font, L.leftTextX, L.bodyTopY);
  question(p1L, 1);
  question(p1L, 2);
  passage(p1L, 3, 4, 7);
  question(p1L, 3);
  question(p1L, 4);

  const p1R = columnCursor(p1, font, L.rightTextX, L.bodyTopY);
  question(p1R, 5);
  question(p1R, 6);
  passage(p1R, 7, 8, 5);
  question(p1R, 7);

  const p2 = pdf.addPage([PAGE_W, PAGE_H]);
  drawFrame(p2, font, frameOpts(2));
  const p2L = columnCursor(p2, font, L.leftTextX, L.bodyTopY);
  question(p2L, 8);
  // 지시문 재사용형: 안내문 바로 아래에 첫 문항이 붙는다(지문 없음).
  p2L.line("[9~10] Choose the expression that fits each blank below.");
  question(p2L, 9);
  question(p2L, 10);

  const p2R = columnCursor(p2, font, L.rightTextX, L.bodyTopY);
  question(p2R, 11);

  // 3쪽: 마지막 문항이 **꼬리말 가까이까지** 내려오는 지면. 꼬리말 감지는 "바로 위
  // 본문과 줄간격의 2.1배 넘게 떨어져 있을 것"을 요구하는데, 이런 지면에서는 그
  // 조건이 그 페이지에서만 깨져 꼬리말이 이미지에 그대로 남았다(실측: 2019 법원직
  // 9급 한국사 3쪽 — 1·2·4쪽은 2.4배라 잡혔는데 3쪽만 1.3배). 다른 페이지에서
  // 확정된 꼬리말과 글자·위치가 같으면 값을 채우는 로직을 이 지면이 검사한다.
  const p3 = pdf.addPage([PAGE_W, PAGE_H]);
  drawFrame(p3, font, frameOpts(3));
  const p3L = columnCursor(p3, font, L.leftTextX, L.bodyTopY);
  question(p3L, 12, { bodyLines: TIGHT_BODY_LINES });
  const p3R = columnCursor(p3, font, L.rightTextX, L.bodyTopY);
  question(p3R, 13);

  return Buffer.from(await pdf.save());
}

// 3쪽 좌단 문항의 부연 줄 수 — 마지막 줄이 꼬리말 바로 위(줄간격의 2.1배 미만)에
// 오도록 맞춘 값이다.
const TIGHT_BODY_LINES = 51;
// 그 문항이 만드는 잉크 줄 수(발문 1 + 부연 + 선지 4).
export const TIGHT_QUESTION_LINES = 1 + TIGHT_BODY_LINES + 4;

export const FIXTURE_QUESTION_COUNT = 13;
// 한 이미지로 묶여야 하는 세트.
export const FIXTURE_MERGED_SETS = [
  [3, 4],
  [7, 8],
];
// 안내문 스트립이 각 문항 위에 붙어야 하는 세트(지시문 재사용형).
export const FIXTURE_STRIP_SET = [9, 10];

// ── 두 번째 픽스처: 구분선이 본문에 바싹 붙고, 꼬리말이 글자가 아니라 괘선인 조판 ──
//
// 실측에서 이 두 가지가 첫 픽스처로는 안 잡혔다:
//   (1) 칼럼 구분선이 **우측 칼럼 본문 바로 옆**(실측 1.7pt)에 있는 조판. 실선을
//       "본문 x 범위에서 6pt 이상 떨어진 것"만 인정하면 이 선이 빠져나가 우측
//       문항 이미지 왼쪽에 세로 실선이 남는다(실측: 2011 법원직 9급 민법,
//       2016 해경 3차 영어).
//   (2) 꼬리말이 텍스트가 아니라 **지면 하단 가로 괘선**인 조판. 좌표 단계의
//       꼬리말 감지는 lines 만 보므로 이 괘선을 못 본다. 칼럼 마지막 문항이 지면
//       바닥까지 잘리고, 괘선이 잉크라 세로 여백 제거까지 막혀 큰 빈칸이 남는다
//       (실측: 해경 계열 — 표본의 26%).
//   (3) 꼬리말 y 가 페이지마다 흔들리는 조판. y 버킷(3pt)이 쪼개져 "절반 이상의
//       페이지"를 못 채우면 꼬리말이 문서 전체에서 하나도 안 잡힌다(실측:
//       2021 법원직 9급 형법 — y 가 33.6/23.4/33.6).
const TIGHT_RULE_TEXT_X = 299; // 구분선(297.5) 바로 오른쪽
const BOTTOM_RULE_Y = 40;

export const RULE_FIXTURE_QUESTION_COUNT = 6;

export async function buildTightRuleFixturePdf({ textFooter = false } = {}) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const L = FIXTURE_LAYOUT;

  for (let p = 0; p < 3; p++) {
    const page = pdf.addPage([PAGE_W, PAGE_H]);
    // 칼럼 구분선만 긋는다(지면 테두리는 없다).
    page.drawLine({
      start: { x: L.columnRuleX, y: 26 },
      end: { x: L.columnRuleX, y: PAGE_H - 26 },
      thickness: RULE_W,
      color: rgb(0, 0, 0),
    });
    // 지면 하단 가로 괘선 — 글자 없는 꼬리말.
    page.drawLine({
      start: { x: L.borderLeftX, y: BOTTOM_RULE_Y },
      end: { x: L.borderRightX, y: BOTTOM_RULE_Y },
      thickness: RULE_W,
      color: rgb(0, 0, 0),
    });
    if (textFooter) {
      // y 를 페이지마다 흔들어 y 버킷 확정을 깨뜨린다(위 (3)).
      page.drawText(`SESSION A TYPE 1 TOTAL 20 - 1${p}`, {
        x: 200,
        y: [33.6, 23.4, 33.6][p],
        size: 9,
        font,
      });
    }
    const left = columnCursor(page, font, L.leftTextX, L.bodyTopY);
    question(left, p * 2 + 1);
    const right = columnCursor(page, font, TIGHT_RULE_TEXT_X, L.bodyTopY);
    question(right, p * 2 + 2);
  }
  return Buffer.from(await pdf.save());
}
