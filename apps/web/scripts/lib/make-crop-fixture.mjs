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

function question(cursor, number) {
  cursor.line(`${number}. Which of the following best describes ${topic(number)}?`);
  cursor.line(`   A further remark on ${topic(number + 1)}.`);
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

  return Buffer.from(await pdf.save());
}

export const FIXTURE_QUESTION_COUNT = 11;
// 한 이미지로 묶여야 하는 세트.
export const FIXTURE_MERGED_SETS = [
  [3, 4],
  [7, 8],
];
// 안내문 스트립이 각 문항 위에 붙어야 하는 세트(지시문 재사용형).
export const FIXTURE_STRIP_SET = [9, 10];
