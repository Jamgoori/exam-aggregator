// 크롭 로직 회귀 테스트: node --test scripts/crop-question-images.test.mjs
//                       (= npm run test-crop)
//
// 실제 문제지 PDF 는 Supabase 에 있고 저장소에 없으므로, 실측에서 보고된 조판
// 결함을 그대로 재현한 합성 PDF(scripts/lib/make-crop-fixture.mjs)로 검사한다.
// **이 테스트는 `npm run regression-check-crop`(실제 문제지 전수 대조)의 대체가
// 아니다** — 그건 여전히 필수다. 여기서 잡는 것은 "DB 없이도 즉시 드러나는"
// 구조적 결함이다:
//   - 문항 이미지 좌·우에 지면 테두리·칼럼 구분선이 남는가
//   - 상단에 머리글(과목명)·괘선이 딸려 오는가
//   - 공통지문 세트가 병합되는가 / 지시문 재사용형이 스트립으로 남는가
//   - 테두리 없는 조판에서 실선 제거 로직이 내용을 건드리지 않는가(대조군)

import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import {
  buildFixturePdf,
  FIXTURE_QUESTION_COUNT,
  FIXTURE_MERGED_SETS,
  FIXTURE_STRIP_SET,
  TIGHT_QUESTION_LINES,
} from "./lib/make-crop-fixture.mjs";
import {
  extractQuestionsFromPdf,
  findVerticalRuleXs,
  computeColumnTextBounds,
  computeHeaderInkBottomByPage,
  computeFooterInkTopByPage,
} from "./crop-question-images.mjs";

const SCALE = 3;
// finalizeQuestionImage 가 사방에 덧대는 흰 여백(8pt × scale).
const PAD_PX = Math.round(8 * SCALE);
// 세로 실선으로 볼 열 채움 비율(잉크 높이 기준). regression-check-crop.mjs 와 같은 값.
const RULE_COVER = 0.98;

// 이미지의 잉크 구조. blocks 는 위아래로 떨어진 잉크 덩어리(=본문 줄) 수라,
// 군더더기(머리글·괘선)가 붙으면 늘고 내용이 깎이면 준다.
async function profile(buffer) {
  const { data, info } = await sharp(buffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const rowHasInk = new Uint8Array(height);
  const colCover = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    const off = y * width;
    for (let x = 0; x < width; x++) {
      if (data[off + x] < 245) {
        rowHasInk[y] = 1;
        colCover[x]++;
      }
    }
  }
  let blocks = 0;
  let firstInk = -1;
  let lastInk = -1;
  for (let y = 0; y < height; y++) {
    if (rowHasInk[y] && (y === 0 || !rowHasInk[y - 1])) blocks++;
    if (rowHasInk[y]) {
      if (firstInk < 0) firstInk = y;
      lastInk = y;
    }
  }
  // 열 채움은 **잉크 높이**로 나눈다. 이미지 높이로 나누면 finalizeQuestionImage 가
  // 덧댄 위아래 여백 때문에 짧은 이미지일수록 과소평가되고, 그걸 맞추려 문턱을
  // 낮추면 지문 상자 테두리가 걸린다(실측: 상자는 0.94, 지면 테두리는 1.0).
  const inkHeight = firstInk < 0 ? 1 : lastInk - firstInk + 1;
  return {
    width,
    height,
    blocks,
    firstInk,
    lastInk,
    // 크롭을 위에서 아래까지 관통하는 열 = 지면 테두리·칼럼 구분선.
    ruleColumns: colCover.filter((c) => c / inkHeight >= RULE_COVER).length,
  };
}

let framed;
let unframed;

test.before(async () => {
  const opts = { scale: SCALE, expectedCount: FIXTURE_QUESTION_COUNT };
  framed = await extractQuestionsFromPdf(await buildFixturePdf({ frame: true }), opts);
  unframed = await extractQuestionsFromPdf(await buildFixturePdf({ frame: false }), opts);
});

test("findVerticalRuleXs: 얇고 긴 세로줄만 실선으로 잡는다", () => {
  const width = 40;
  const height = 100;
  const data = new Uint8Array(width * height).fill(255);
  const paint = (x0, x1, y0, y1) => {
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) data[y * width + x] = 0;
  };
  paint(3, 5, 0, 100); // 얇고 지면 전체 → 실선
  paint(10, 20, 0, 100); // 두꺼움 → 실선 아님
  paint(30, 32, 0, 40); // 짧음 → 실선 아님
  const rules = findVerticalRuleXs(data, width, height, { maxWidthPx: 4, minCover: 0.8 });
  assert.deepEqual(rules, [{ x0: 3, x1: 4 }]);
});

test("computeColumnTextBounds: 머리글·꼬리말을 뺀 본문 x 범위", () => {
  const lines = [
    { col: "L", y: 800, x: 40, right: 500, text: "머리글" },
    { col: "L", y: 700, x: 45, right: 280, text: "본문1" },
    { col: "L", y: 690, x: 50, right: 270, text: "본문2" },
    { col: "L", y: 680, x: 48, right: 275, text: "본문3" },
    { col: "L", y: 30, x: 250, right: 400, text: "꼬리말" },
    { col: "R", y: 700, x: 312, right: 550, text: "우측" },
  ];
  assert.deepEqual(computeColumnTextBounds(lines, "L", 800, 30), { minX: 45, maxX: 280 });
  // 머리글 감지가 빗나가 본문까지 걷어내면 범위가 실제보다 좁아져 본문을 자른다.
  // 남는 줄이 너무 적으면 거르지 않은 전체를 쓴다.
  assert.deepEqual(computeColumnTextBounds(lines, "L", 695, 30), { minX: 40, maxX: 500 });
  // 줄이 아예 부족하면 손대지 않는다(null).
  assert.equal(computeColumnTextBounds(lines, "R", null, null), null);
  // 1단 조판은 좌·우 줄을 함께 봐야 지면 절반에서 범위가 끊기지 않는다.
  assert.deepEqual(computeColumnTextBounds(lines, ["L", "R"], 800, 30), { minX: 45, maxX: 550 });
});

test("computeHeaderInkBottomByPage: 되풀이되는 본문 줄을 머리글로 오인하지 않는다", () => {
  const line = (y, text, x = 40) => ({ col: "L", y, x, right: 280, height: 10, text });
  // 두 페이지 모두 맨 위 줄은 같은 머리글, 그 아래로 같은 문구의 선지가 반복된다.
  const body = (y) => [
    line(y, "1. 서로 다른 발문"),
    line(y - 13, "① 옳다"),
    line(y - 26, "② 옳지 않다"),
    line(y - 39, "③ 알 수 없다"),
  ];
  const page = () => ({
    pageHeightPt: 842,
    // 마커·안내문은 반드시 본문 — 이보다 아래는 머리글 후보에서 빠진다.
    markers: [{ number: 1, x: 40, y: 770, height: 10 }],
    groups: [],
    lines: [line(800, "국어 25문"), ...body(770)],
  });
  const pages = [page(), page()];
  // 머리글(y=800)만 잡혀야 한다. 선지 줄(y=757 등)까지 잡히면 머리글 띠가 본문
  // 한복판까지 내려와 dropRunningHeader 가 본문을 걷어낸다.
  assert.deepEqual(computeHeaderInkBottomByPage(pages), [800, 800]);
});

test("computeFooterInkTopByPage: 그 페이지만 여백이 좁아도 꼬리말을 놓치지 않는다", () => {
  const line = (y, text, height = 10) => ({ col: "L", y, x: 40, right: 280, height, text });
  // 줄간격 중앙값이 제대로 잡히도록 본문을 충분히 채운다(성글면 medianLineLead 가
  // 본문↔꼬리말 간격을 줄간격으로 오인해 덩어리 판정이 무너진다).
  const body = (n, until) =>
    Array.from({ length: n }, (_, i) => line(until + (n - 1 - i) * 13, `본문 ${i}쪽줄`));
  // 1·2쪽은 꼬리말 위 여백이 넉넉하고, 3쪽만 마지막 선지가 꼬리말 가까이 내려온다.
  const page = (tight) => ({
    pageHeightPt: 842,
    markers: [{ number: 1, x: 40, y: 700, height: 10 }],
    groups: [],
    lines: [...body(20, tight ? 60 : 300), line(34, "국어 23 - 1", 15)],
  });
  const got = computeFooterInkTopByPage([page(false), page(false), page(true)]);
  // 세 쪽 모두 같은 값이어야 한다. 3쪽이 null 이면 그 쪽 마지막 문항 크롭이 지면
  // 바닥까지 내려가 꼬리말이 이미지에 그대로 남는다.
  assert.deepEqual(got, [49, 49, 49]);
});

test("문항 수와 세트 병합", () => {
  assert.equal(framed.length, FIXTURE_QUESTION_COUNT);
  const byNumber = new Map(framed.map((c) => [c.number, c]));

  for (const set of FIXTURE_MERGED_SETS) {
    for (const n of set) {
      assert.deepEqual(byNumber.get(n).groupNumbers, set, `${n}번이 세트 ${set}로 묶여야 한다`);
    }
    // 세트는 이미지 하나를 공유한다(업로드가 경로 하나만 저장한다).
    assert.equal(byNumber.get(set[0]).image, byNumber.get(set[1]).image);
  }
  // 지시문 재사용형은 병합하지 않고 안내문 스트립만 각자 위에 붙인다.
  for (const n of FIXTURE_STRIP_SET) {
    assert.equal(byNumber.get(n).groupNumbers, undefined, `${n}번은 병합 대상이 아니다`);
  }
});

test("지면 테두리·칼럼 구분선이 이미지에 남지 않는다", async () => {
  for (const c of framed) {
    const p = await profile(c.image);
    assert.equal(p.ruleColumns, 0, `${c.number}번에 세로 실선이 남았다`);
  }
});

test("실선 검사가 실제로 실선을 잡는다 (양성 대조군)", async () => {
  // 위 검사가 "0건"인 게 검사가 무딘 탓이 아님을 확인한다 — 멀쩡한 결과 이미지에
  // 지면 테두리를 흉내 낸 세로줄을 그려 넣으면 반드시 걸려야 한다.
  const { width, height } = await sharp(framed[0].image).metadata();
  const rule = Buffer.from(
    `<svg width="${width}" height="${height}"><rect x="2" y="0" width="2" height="${height}" fill="black"/></svg>`,
  );
  const withRule = await sharp(framed[0].image)
    .composite([{ input: rule, top: 0, left: 0 }])
    .png()
    .toBuffer();
  const p = await profile(withRule);
  assert.ok(p.ruleColumns > 0, "세로 실선을 못 잡는다 — 검사가 무디다");
});

test("위아래 군더더기 없이 잉크가 이미지를 꽉 채운다", async () => {
  // 머리글·괘선이 붙거나 칼럼 바닥까지의 빈 공간이 남으면 이 조건이 깨진다
  // (실선이 남아 있으면 세로 여백 제거가 무력화돼 빈 공간이 그대로 남는다).
  for (const c of framed) {
    const p = await profile(c.image);
    assert.equal(p.firstInk, PAD_PX, `${c.number}번 위쪽 여백이 어긋났다`);
    assert.equal(p.lastInk, p.height - PAD_PX - 1, `${c.number}번 아래쪽 여백이 어긋났다`);
  }
});

test("한 문제지 안에서 이미지 폭이 모두 같다", async () => {
  const widths = new Set();
  for (const c of framed) widths.add((await profile(c.image)).width);
  assert.equal(widths.size, 1, `폭이 갈렸다: ${[...widths]}`);
});

test("문항마다 기대한 줄(잉크 덩어리) 수가 그대로 나온다", async () => {
  // 일반 문항 6줄(발문 1 + 부연 1 + 선지 4).
  // 병합 세트 = 안내문 1 + 지문 상자 1덩어리 + 문항 2개 × 6줄 = 14.
  // 지시문 재사용형 = 안내문 스트립 1 + 6.
  const expected = new Map([
    [1, 6], [2, 6], [3, 14], [4, 14], [5, 6], [6, 6],
    [7, 14], [8, 14], [9, 7], [10, 7], [11, 6],
    // 12번은 꼬리말 바로 위까지 내려오는 문항 — 꼬리말이 남으면 줄 수가 늘어난다.
    [12, TIGHT_QUESTION_LINES], [13, 6],
  ]);
  for (const c of framed) {
    const p = await profile(c.image);
    assert.equal(p.blocks, expected.get(c.number), `${c.number}번 줄 수가 다르다`);
  }
});

test("테두리 없는 조판에서는 내용이 그대로다(대조군)", async () => {
  assert.equal(unframed.length, framed.length);
  const framedProfiles = new Map();
  for (const c of framed) framedProfiles.set(c.number, await profile(c.image));
  for (const c of unframed) {
    const p = await profile(c.image);
    const f = framedProfiles.get(c.number);
    assert.equal(p.blocks, f.blocks, `${c.number}번 줄 수가 테두리 유무로 달라졌다`);
    assert.equal(p.height, f.height, `${c.number}번 높이가 테두리 유무로 달라졌다`);
    assert.equal(p.ruleColumns, 0);
  }
  // 테두리를 걷어낸 쪽이 그만큼 좁아야 한다 — 안 좁아지면 실선을 못 걷어낸 것이다.
  const framedWidth = [...framedProfiles.values()][0].width;
  const plainWidth = (await profile(unframed[0].image)).width;
  assert.ok(framedWidth < plainWidth, `테두리 크롭이 폭을 줄이지 못했다 (${framedWidth} vs ${plainWidth})`);
});
