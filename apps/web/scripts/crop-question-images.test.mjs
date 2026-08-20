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
  normalizeFullwidthDigits,
  dropInkAboveBaseline,
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

test("normalizeFullwidthDigits: 전각 번호 마커가 반각과 똑같이 걸린다", () => {
  // 실측(2022 소방 간부후보 전기공학개론): 한 문제지 안에서 1·9~25번은 반각인데
  // 2~8번만 전각이라 그 7개가 통째로 사라졌다.
  assert.equal(normalizeFullwidthDigits("２. 다음은"), "2. 다음은");
  assert.equal(normalizeFullwidthDigits("１０."), "10.");
  // 숫자만 바꾼다 — 다른 전각 글자는 그대로 둔다.
  assert.equal(normalizeFullwidthDigits("＜보기＞ ７"), "＜보기＞ 7");
  // 반각뿐이면 원본 문자열을 그대로 돌려준다(불필요한 복사 방지).
  const plain = "9. 다음 중";
  assert.equal(normalizeFullwidthDigits(plain), plain);
  // 전역 플래그 정규식을 재사용해도 lastIndex 때문에 결과가 흔들리지 않는다.
  for (let i = 0; i < 3; i++) assert.equal(normalizeFullwidthDigits("３."), "3.");
});

test("dropInkAboveBaseline: baseline 바로 위에서 끝나는 첫 본문 줄을 지우지 않는다", async () => {
  // 한글 글리프는 디센더 없이 baseline 위에 얹혀서, 본문 첫 줄 잉크가 baseline
  // 행보다 한 px 위에서 끝날 수 있다. 여유(slack) 없이 "baseline 행까지 닿는가"만
  // 보면 **발문 한 줄이 통째로 지워진다**(실측: 2024 소방 간부후보 행정법총론 3번 —
  // 덩어리 37..71 행, baseline 행 72). 폰트에 기대지 않도록 래스터를 직접 만든다.
  const width = 20;
  const height = 100;
  const band = (y0, y1) => ({ y0, y1 });
  const render = async (bands) => {
    const buf = Buffer.alloc(width * height, 255);
    for (const b of bands) buf.fill(0, b.y0 * width, b.y1 * width);
    return sharp(buf, { raw: { width, height, channels: 1 } }).png().toBuffer();
  };
  const inkRows = async (png) => {
    const { data, info } = await sharp(png).greyscale().raw().toBuffer({ resolveWithObject: true });
    const rows = [];
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++)
        if (data[y * info.width + x] < 245) { rows.push(y); break; }
    return { first: rows[0], last: rows[rows.length - 1], height: info.height };
  };

  // 머리글(10..20) + 본문 첫 줄(40..71). baseline 행은 72 — 본문 줄이 1px 못 미친다.
  const png = await render([band(10, 21), band(40, 72)]);
  const slack = 3;
  const cleaned = await dropInkAboveBaseline(png, 72, 54, slack);
  const got = await inkRows(cleaned);
  // 머리글만 걷히고 본문 첫 줄은 남아야 한다.
  assert.equal(got.height, height - 40, "본문 첫 줄 위쪽만 잘려야 한다");
  assert.equal(got.first, 0, "본문 첫 줄이 남아 맨 위에 와야 한다");

  // 여유가 0이면 예전 동작 그대로 본문 첫 줄이 지워진다(이 테스트가 지키는 회귀).
  const noSlack = await dropInkAboveBaseline(png, 72, 54, 0);
  assert.equal(noSlack, null, "여유 없이는 본문 줄까지 걷어내 빈 조각이 된다");

  // 여유가 머리글까지 살려주면 안 된다 — 머리글은 baseline 에서 한참 위에서 끝난다.
  const headerOnly = await dropInkAboveBaseline(await render([band(10, 21), band(80, 95)]), 90, 54, slack);
  assert.equal((await inkRows(headerOnly)).height, height - 80, "머리글은 그대로 걷힌다");
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

test("computeFooterInkTopByPage: 어느 페이지도 여백 조건을 못 넘어도 쪽 꼬리말은 잡는다", () => {
  // 실측(2026 소방 소방학개론): 지면 한가운데 정렬된 꼬리말("1 / 24")이 legacy 전략의
  // 칼럼 경계(폭/2)에서는 좌측 칼럼에 붙는데, 그 칼럼 마지막 본문 줄과의 간격이
  // 늘 1.47배뿐이라 **6쪽 전부** 엄격 조건(2.1배)에 걸려 null 이 됐다. 그러면
  // 마지막 문항 크롭이 지면 바닥까지 내려가 쪽번호와 빈 공간이 그대로 남는다.
  const line = (y, text, height = 10) => ({ col: "L", y, x: 40, right: 280, height, text });
  const body = (n, until) =>
    Array.from({ length: n }, (_, i) => line(until + (n - 1 - i) * 13, `본문 ${i} 줄 내용`));
  // 본문 마지막 줄 y=53, 꼬리말 y=34 → 간격 19 = 줄간격(13)의 1.46배. 2.1배에 못 미친다.
  const page = (no) => ({
    pageHeightPt: 842,
    markers: [{ number: 1, x: 40, y: 700, height: 10 }],
    groups: [],
    lines: [...body(20, 53), line(34, `${no} / 24`, 15)],
  });
  assert.deepEqual(computeFooterInkTopByPage([page(1), page(2), page(3)]), [49, 49, 49]);

  // **안전장치**: 원문까지 똑같이 되풀이되는 줄은 꼬리말이 아니다. 짧고 정형화된
  // 선지가 매 쪽 같은 자리에 오는 조판에서 이걸 꼬리말로 보면 그 문항이 통째로
  // 사라진다(이 문서가 기록한 2017 국가직 9급 국어 사고). 쪽번호는 페이지마다
  // 바뀌지만 되풀이 본문 줄은 안 바뀐다는 차이로 가른다.
  const samePage = () => ({
    pageHeightPt: 842,
    markers: [{ number: 1, x: 40, y: 700, height: 10 }],
    groups: [],
    lines: [...body(20, 53), line(34, "① 옳지 않다", 15)],
  });
  assert.deepEqual(computeFooterInkTopByPage([samePage(), samePage(), samePage()]), [null, null, null]);
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
