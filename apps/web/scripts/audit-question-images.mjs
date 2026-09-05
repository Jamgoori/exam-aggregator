// 사용법: npm run audit-question-images -- [--sample N] [--paper-ids <파일>] [--concurrency 8]
//                                          [--out report.json] [--dump-dir <디렉터리>] [--dump 20]
//         npm run audit-question-images -- --empty-scan [--empty-bytes 2000] [--concurrency 24]
//
// **이미 올라간 문항 이미지(= 문제별 풀기 화면에 실제로 보이는 그림)** 를 그대로
// 내려받아 "순수하게 문제만 있는지"를 잰다. regression-check-crop 과 목적이 다르다:
//   - regression-check-crop → 크롭 **로직을 고쳤을 때** 새/옛 코드를 나란히 돌려
//     문항 수·세트 수·기하가 나빠지지 않았는지 본다(PDF 를 다시 렌더한다, 느리다).
//   - 이 스크립트    → 코드와 무관하게 **지금 서비스에 나가 있는 이미지 자체**를 본다.
//     로직을 고쳐도 백필하지 않으면 옛 이미지가 그대로 남으므로(문서의 "백필" 절),
//     "로직은 고쳤는데 화면은 그대로"인 상태를 잡는 유일한 검사다.
//
// 읽기만 한다 — publishable 키로 충분하고 DB 에 아무것도 쓰지 않는다.
//
// 재는 것(모두 이미지 픽셀 기하다. 글자 내용은 못 본다 — 마지막의 육안 확인은 여전히 필요):
//   ruleCols   세로 실선. 잉크 높이의 RULE_COVER 이상을 채우는 열. 지면 테두리·칼럼
//              구분선이 남은 신호다. **이미지 높이가 아니라 잉크 높이로 나눈다**
//              (문서 "ruleCols 지표" 절 — 이미지 높이로 나누면 지문 상자 테두리가
//              무더기로 오검출된다).
//   edgeInk    좌우 맨 끝 열에 잉크가 닿은 비율. 잘림/옆칼럼 침범 신호.
//   topJunk    맨 위 잉크 덩어리가 얇고(TOP_JUNK_MAX_PT) 그 아래 본문과 줄간격보다
//              훨씬 크게(JUNK_GAP_RATIO) 떨어져 있으면 머리글 잔해로 의심한다.
//   bottomJunk 같은 판정을 아래에서 — 쪽 꼬리말 잔해.
//   choiceMarks 왼쪽 띠에서 찾은 "동그라미 숫자(①~⑤)처럼 생긴" 덩어리 수.
//              questions.choice_count 보다 적으면 선지가 잘렸을 수 있다.
//   widthCount 한 문제지 안의 폭 종류. 2 이상이면 문항마다 글씨 크기가 달라 보인다.
//
// 어느 지표도 그 자체로 확정이 아니다 — 걸린 것을 --dump-dir 로 받아 **눈으로 볼 것**.

import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const concurrency = args.concurrency ? Number(args.concurrency) : 8;
const sampleSize = args.sample ? Number(args.sample) : 0; // 0 = 전수
const outPath = typeof args.out === "string" ? args.out : "question-image-audit.json";
const dumpDir = typeof args["dump-dir"] === "string" ? args["dump-dir"] : null;
const dumpLimit = args.dump ? Number(args.dump) : 24;
const seed = args.seed ? Number(args.seed) : 20260904;
// --empty-scan: 픽셀을 재지 않고 **공개 URL 에 HEAD 만** 날려 크기로 "사실상 빈
// 이미지"만 찾는다. 전수(10만 장 이상)를 훑을 때 쓰는 값싼 모드다.
const emptyScan = Boolean(args["empty-scan"]);
const emptyBytes = args["empty-bytes"] ? Number(args["empty-bytes"]) : 2000;

// 크롭 산출물은 scale 3 이므로 1pt = 3px 이다.
const PX_PER_PT = 3;
const RULE_COVER = 0.98; // 잉크 높이 대비. 지면 테두리는 1.0, 지문 상자는 0.94 (문서 참고)
const RULE_MAX_WIDTH_PX = 4 * PX_PER_PT; // 굵은 세로줄은 실선이 아니라 그림/표다
const EDGE_INK_LIMIT = 0.05;
const TOP_JUNK_MAX_PT = 18; // crop-question-images.mjs 의 TOP_JUNK_MAX_PT 와 같은 값
const JUNK_GAP_RATIO = 2.1; // 꼬리말 판정과 같은 비율(FOOTER_GAP_RATIO)
const INK = 245; // 이 값보다 어두우면 잉크

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const readKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !readKey) {
  console.error(
    ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다.",
  );
  process.exit(1);
}
const supabase = createClient(supabaseUrl, readKey);

async function fetchAllRows(table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + 999);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

// 재현 가능한 표본을 뽑으려고 고정 시드 난수를 쓴다(같은 --seed 면 같은 표본).
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 픽셀 기하 ───────────────────────────────────────────────────────────────

// 잉크가 있는 행을 위에서 아래로 훑어 "덩어리(= 본문 줄 또는 그림 블록)"로 묶는다.
function inkRowBlocks(data, width, height) {
  const blocks = [];
  let start = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let has = false;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < INK) {
        has = true;
        break;
      }
    }
    if (has && start < 0) start = y;
    if (!has && start >= 0) {
      blocks.push({ top: start, bottom: y - 1 });
      start = -1;
    }
  }
  if (start >= 0) blocks.push({ top: start, bottom: height - 1 });
  return blocks;
}

function median(nums) {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

// 위/아래 끝의 "얇고 뚝 떨어진" 덩어리 = 머리글·꼬리말 잔해 의심.
// 덩어리가 하나뿐이면(본문 전체가 한 덩어리) 판정하지 않는다.
function junkAt(blocks, edge) {
  if (blocks.length < 2) return null;
  const gaps = [];
  for (let i = 0; i < blocks.length - 1; i++) gaps.push(blocks[i + 1].top - blocks[i].bottom);
  const typicalGap = median(gaps);
  if (typicalGap <= 0) return null;
  const b = edge === "top" ? blocks[0] : blocks[blocks.length - 1];
  const gap = edge === "top" ? gaps[0] : gaps[gaps.length - 1];
  const heightPt = (b.bottom - b.top + 1) / PX_PER_PT;
  if (heightPt > TOP_JUNK_MAX_PT) return null;
  if (gap < typicalGap * JUNK_GAP_RATIO) return null;
  return { heightPt: Number(heightPt.toFixed(1)), gapRatio: Number((gap / typicalGap).toFixed(2)) };
}

// 왼쪽 띠에서 "동그라미 숫자(①~⑤)처럼 생긴" 덩어리를 센다. 선지 글리프는 본문
// 왼쪽 끝에 붙은 **속이 빈 정사각형에 가까운** 연결 성분이라 이 셋으로 가른다.
// OCR 이 아니므로 정확한 개수가 아니라 **선지가 통째로 빠진 이미지를 골라내는
// 신호**로만 쓴다(㉠·⑴ 같은 글리프도 걸릴 수 있다).
function countChoiceMarks(data, width, height, inkLeft) {
  // 씨앗은 왼쪽 띠에서만 잡되(선지 글리프는 줄 맨 앞에 붙는다), **덩어리 자체는
  // 띠 밖으로 이어져도 끝까지 훑는다** — 동그라미 지름이 실측 30px(=10pt)이라
  // 띠를 좁게 잡고 "띠를 벗어나면 버림"으로 처리하면 정작 동그라미가 전부 버려진다.
  const seedRight = Math.min(width - 1, inkLeft + 40 * PX_PER_PT);
  const seen = new Uint8Array(width * height);
  let marks = 0;
  for (let y = 0; y < height; y++) {
    for (let x = inkLeft; x <= seedRight; x++) {
      const idx = y * width + x;
      if (seen[idx] || data[idx] >= INK) continue;
      const stack = [idx];
      seen[idx] = 1;
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixels = 0;
      let tooBig = false;
      const cells = [];
      while (stack.length > 0) {
        const cur = stack.pop();
        const cx = cur % width;
        const cy = (cur - cx) / width;
        pixels++;
        cells.push(cur);
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;
        if (pixels > 20000) {
          tooBig = true; // 표·상자 테두리처럼 이어진 덩어리 — 선지 글리프가 아니다
          break;
        }
        if (cx > 0) {
          const nb = cur - 1;
          if (!seen[nb] && data[nb] < INK) { seen[nb] = 1; stack.push(nb); }
        }
        if (cx < width - 1) {
          const nb = cur + 1;
          if (!seen[nb] && data[nb] < INK) { seen[nb] = 1; stack.push(nb); }
        }
        if (cy > 0) {
          const nb = cur - width;
          if (!seen[nb] && data[nb] < INK) { seen[nb] = 1; stack.push(nb); }
        }
        if (cy < height - 1) {
          const nb = cur + width;
          if (!seen[nb] && data[nb] < INK) { seen[nb] = 1; stack.push(nb); }
        }
      }
      if (tooBig) continue;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const sizePt = h / PX_PER_PT;
      if (sizePt < 6 || sizePt > 16) continue; // 본문 글자 크기 언저리만
      const aspect = w / h;
      if (aspect < 0.8 || aspect > 1.25) continue; // 동그라미는 거의 정사각형
      if (pixels / (w * h) > 0.45) continue; // 속이 빈 테두리라 채움률이 낮다
      // 가운데가 비었는지(도넛) 확인 — 안에 숫자가 있어도 테두리에 한참 못 미친다.
      let centerPixels = 0;
      const cx0 = minX + w * 0.35;
      const cx1 = minX + w * 0.65;
      const cy0 = minY + h * 0.35;
      const cy1 = minY + h * 0.65;
      for (const cur of cells) {
        const px = cur % width;
        const py = (cur - px) / width;
        if (px >= cx0 && px <= cx1 && py >= cy0 && py <= cy1) centerPixels++;
      }
      if (centerPixels / pixels > 0.12) continue;
      marks++;
    }
  }
  return marks;
}

async function measure(buf) {
  const { data, info } = await sharp(buf).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  let inkLeft = width;
  let inkRight = -1;
  let inkTop = -1;
  let inkBottom = -1;
  let edgeL = 0;
  let edgeR = 0;
  const colCover = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let rowHasInk = false;
    for (let x = 0; x < width; x++) {
      if (data[row + x] < INK) {
        if (x < inkLeft) inkLeft = x;
        if (x > inkRight) inkRight = x;
        colCover[x]++;
        rowHasInk = true;
      }
    }
    if (rowHasInk) {
      if (inkTop < 0) inkTop = y;
      inkBottom = y;
    }
    if (data[row] < INK) edgeL++;
    if (data[row + width - 1] < INK) edgeR++;
  }
  if (inkRight < 0) {
    return { width, height, blank: true };
  }
  const inkHeight = inkBottom - inkTop + 1;
  // 세로 실선: 잉크 높이를 거의 다 채우는 열이 **가늘게 이어진 덩어리**일 때만 인정한다.
  // 넓은 덩어리는 그림·표라 실선이 아니다.
  const ruleRuns = [];
  let runStart = -1;
  for (let x = 0; x <= width; x++) {
    const isRule = x < width && colCover[x] / inkHeight >= RULE_COVER;
    if (isRule && runStart < 0) runStart = x;
    if (!isRule && runStart >= 0) {
      const w = x - runStart;
      if (w <= RULE_MAX_WIDTH_PX) ruleRuns.push({ x: runStart, w });
      runStart = -1;
    }
  }
  const blocks = inkRowBlocks(data, width, height);
  return {
    width,
    height,
    blank: false,
    inkLeft,
    inkRight,
    inkTop,
    inkBottom,
    blocks: blocks.length,
    skew: Math.abs(inkLeft - (width - 1 - inkRight)),
    edgeInk: Number(Math.max(edgeL / height, edgeR / height).toFixed(3)),
    ruleRuns,
    topJunk: junkAt(blocks, "top"),
    bottomJunk: junkAt(blocks, "bottom"),
    choiceMarks: countChoiceMarks(data, width, height, inkLeft),
  };
}

// ── 대상 수집 ───────────────────────────────────────────────────────────────

console.log("대상 수집 중...");
const papers = await fetchAllRows("exam_papers", "id, title, year, level, question_count");
const paperById = new Map(papers.map((p) => [p.id, p]));
const questions = await fetchAllRows("questions", "id, paper_id, question_number, choice_count");
const qById = new Map(questions.map((q) => [q.id, q]));
const images = await fetchAllRows("question_images", "question_id, order_index, image_path");

// 세트문제는 여러 번호가 같은 경로를 가리킨다 — 같은 이미지를 여러 번 받지 않는다.
const byPath = new Map();
for (const img of images) {
  const q = qById.get(img.question_id);
  if (!q) continue;
  const rec = byPath.get(img.image_path);
  if (rec) {
    rec.numbers.push(q.question_number);
    rec.choiceCount = Math.max(rec.choiceCount, q.choice_count ?? 0);
    continue;
  }
  byPath.set(img.image_path, {
    path: img.image_path,
    paperId: q.paper_id,
    numbers: [q.question_number],
    choiceCount: q.choice_count ?? 0,
  });
}

let targets = [...byPath.values()];
targets.sort((a, b) => a.path.localeCompare(b.path));
const totalImages = targets.length;

if (typeof args["paper-ids"] === "string") {
  const ids = new Set(
    fs.readFileSync(args["paper-ids"], "utf8").split("\n").map((s) => s.trim()).filter(Boolean),
  );
  targets = targets.filter((t) => ids.has(t.paperId));
}
if (sampleSize && sampleSize < targets.length) {
  // 문제지를 고루 뽑는다 — 한 문제지에서 몰아 뽑으면 조판 변형을 못 본다.
  const rnd = mulberry32(seed);
  const byPaper = new Map();
  for (const t of targets) {
    if (!byPaper.has(t.paperId)) byPaper.set(t.paperId, []);
    byPaper.get(t.paperId).push(t);
  }
  const paperIds = [...byPaper.keys()].sort();
  for (let i = paperIds.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [paperIds[i], paperIds[j]] = [paperIds[j], paperIds[i]];
  }
  // 문제지 안에서도 **무작위로** 고른다. 앞에서부터 고르면 표본이 죄다 1번
  // 문항이 되는데, 1번은 언제나 좌측 칼럼 맨 위라 **꼬리말 잔해·칼럼 넘김처럼
  // 칼럼 끝에서만 나는 결함이 표본에서 통째로 빠진다.**
  for (const list of byPaper.values()) {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
  }
  const picked = [];
  let round = 0;
  while (picked.length < sampleSize) {
    let addedThisRound = 0;
    for (const pid of paperIds) {
      const list = byPaper.get(pid);
      if (round >= list.length) continue;
      picked.push(list[round]);
      addedThisRound++;
      if (picked.length >= sampleSize) break;
    }
    if (addedThisRound === 0) break;
    round++;
  }
  targets = picked;
}

console.log(
  `등록된 문항 이미지 ${totalImages}장(세트 공유 제외) 중 ${targets.length}장 검사 (동시성 ${concurrency})\n`,
);

// ── 값싼 전수 모드: 크기로 "사실상 빈 이미지"만 찾는다 ─────────────────────
//
// 가짜 마커가 잡히면 엉뚱한 자리를 잘라 **괘선 한 줄뿐인 이미지**가 나오고, 진짜
// 문항은 통째로 사라진다(실측: 2020 해경 3차 한국사 14번 — 102바이트). 문항 수는
// 맞아떨어지므로 회귀 검사도 배치 스크립트도 이걸 못 잡는다. 정상 문항 이미지는
// 30~200KB 라 크기만으로 충분히 갈린다.
//
// **`storage.list()` 를 쓰지 말 것** — 버킷이 public read 라 목록 API 는 에러 없이
// 빈 배열을 돌려준다. 그걸 믿으면 "빈 이미지 0장"이라는 잘못된 결론이 나온다.
// 공개 URL 에 HEAD 를 날려 content-length 를 본다(동시성 24로 2,000장에 3분).
if (emptyScan) {
  console.log(`빈 이미지 검사: ${targets.length}장 (${emptyBytes}바이트 미만, 동시성 ${concurrency})`);
  const found = [];
  let scanCursor = 0;
  let scanDone = 0;
  async function scanWorker() {
    for (;;) {
      const i = scanCursor++;
      if (i >= targets.length) return;
      const t = targets[i];
      try {
        const res = await fetch(
          `${supabaseUrl}/storage/v1/object/public/exam-papers/${t.path}`,
          { method: "HEAD" },
        );
        const size = Number(res.headers.get("content-length") ?? 0);
        if (res.ok && size < emptyBytes) {
          const paper = paperById.get(t.paperId) ?? {};
          found.push({ ...t, size, title: paper.title, year: paper.year });
        }
      } catch {
        // 일시적 네트워크 실패는 무시한다(빈 이미지 판정에 영향이 없다).
      }
      scanDone++;
      if (scanDone % 5000 === 0) console.log(`  ${scanDone}/${targets.length} (빈 이미지 ${found.length})`);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, scanWorker));
  found.sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || String(a.title).localeCompare(String(b.title)));
  fs.writeFileSync(outPath, JSON.stringify({ totalImages, emptyBytes, found }, null, 2));
  console.log(
    `\n사실상 빈 이미지 ${found.length}장 / 문제지 ${new Set(found.map((f) => f.paperId)).size}장`,
  );
  for (const f of found.slice(0, 40)) {
    console.log(`  ${f.year} ${f.title} ${f.numbers.join("·")}번 — ${f.size}B (${f.path})`);
  }
  console.log(`\n리포트: ${outPath}`);
  process.exit(0);
}

if (dumpDir) fs.mkdirSync(dumpDir, { recursive: true });

const results = [];
let done = 0;
let cursor = 0;

async function worker() {
  for (;;) {
    const i = cursor++;
    if (i >= targets.length) return;
    const t = targets[i];
    const paper = paperById.get(t.paperId) ?? {};
    const rec = {
      path: t.path,
      paperId: t.paperId,
      title: paper.title,
      year: paper.year,
      
      level: paper.level,
      numbers: t.numbers.sort((a, b) => a - b),
      choiceCount: t.choiceCount,
    };
    try {
      const { data: blob, error } = await supabase.storage.from("exam-papers").download(t.path);
      if (error) throw new Error(error.message);
      const buf = Buffer.from(await blob.arrayBuffer());
      Object.assign(rec, await measure(buf));
      if (dumpDir) rec.buf = buf;
    } catch (err) {
      rec.error = err.message;
    }
    results.push(rec);
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${targets.length}`);
  }
}

await Promise.all(Array.from({ length: concurrency }, worker));

// ── 판정 ────────────────────────────────────────────────────────────────────

const ok = results.filter((r) => !r.error && !r.blank);
const ruled = ok.filter((r) => (r.ruleRuns?.length ?? 0) > 0);
const edgeCut = ok.filter((r) => r.edgeInk > EDGE_INK_LIMIT);
const topJunk = ok.filter((r) => r.topJunk);
const bottomJunk = ok.filter((r) => r.bottomJunk);
const blanks = results.filter((r) => r.blank);
const errors = results.filter((r) => r.error);
// 선지 부족: **개수를 맞추려 들면 안 된다.** 선지를 2열로 놓는 조판(①③ 왼쪽,
// ②④ 오른쪽)에서는 왼쪽 띠에서 절반만 잡히고(실측 2/4), 반대로 "ㅇ"이 든 한글
// 글자·영문 O·숫자 0 이 동그라미로 오검출되기도 한다. 가운데 띠까지 같이 보면
// 오검출이 늘어 **정작 선지가 통째로 없는 이미지가 정상으로 보인다**(실측: 2022
// 국가직 9급 재배학개론이 0 → 4 로 뒤집혔다). 그래서 왼쪽 띠만 보고, 노리는 것도
// 하나뿐이다 — **선지 번호가 통째로 빠진 이미지**(거의 0개).
const missingChoices = ok.filter((r) => r.choiceCount > 0 && r.choiceMarks <= 1);

// 폭 갈림은 문제지 단위 지표다(표본이 한 문제지에서 2장 이상일 때만 의미가 있다).
const widthsByPaper = new Map();
for (const r of ok) {
  if (!widthsByPaper.has(r.paperId)) widthsByPaper.set(r.paperId, new Set());
  widthsByPaper.get(r.paperId).add(r.width);
}
const mixedWidth = [...widthsByPaper.entries()].filter(([, s]) => s.size > 1);

function label(r) {
  return `${r.year} ${r.title} ${r.numbers.join("·")}번 (${r.path})`;
}

console.log(`\n===== 결과 (검사 ${results.length}장 / 정상 판독 ${ok.length}장) =====`);
console.log(`세로 실선 남음: ${ruled.length}장`);
for (const r of ruled.slice(0, 15))
  console.log(`  ${label(r)} — 열 ${r.ruleRuns.map((x) => `x=${x.x}(w${x.w})`).join(", ")}`);
console.log(`가장자리 잉크 > ${EDGE_INK_LIMIT * 100}%: ${edgeCut.length}장`);
for (const r of edgeCut.slice(0, 15)) console.log(`  ${label(r)} — ${(r.edgeInk * 100).toFixed(1)}%`);
console.log(`상단 군더더기(머리글 잔해 의심): ${topJunk.length}장`);
for (const r of topJunk.slice(0, 15))
  console.log(`  ${label(r)} — 높이 ${r.topJunk.heightPt}pt, 간격 ${r.topJunk.gapRatio}배`);
console.log(`하단 군더더기(꼬리말 잔해 의심): ${bottomJunk.length}장`);
for (const r of bottomJunk.slice(0, 15))
  console.log(`  ${label(r)} — 높이 ${r.bottomJunk.heightPt}pt, 간격 ${r.bottomJunk.gapRatio}배`);
console.log(`선지로 보이는 표시가 모자람: ${missingChoices.length}장`);
for (const r of missingChoices.slice(0, 20))
  console.log(`  ${label(r)} — 찾음 ${r.choiceMarks} / 기대 ${r.choiceCount * r.numbers.length}`);
console.log(`문제지 안에서 폭 갈림: ${mixedWidth.length}개 문제지`);
for (const [pid, s] of mixedWidth.slice(0, 10))
  console.log(`  ${paperById.get(pid)?.year} ${paperById.get(pid)?.title} — 폭 ${[...s].join(", ")}`);
console.log(`빈 이미지: ${blanks.length}장 / 내려받기·판독 실패: ${errors.length}장`);
for (const r of errors.slice(0, 10)) console.log(`  ${label(r)} — ${r.error}`);

// 걸린 것을 눈으로 보라고 파일로 떨군다(지표는 어느 것도 확정이 아니다).
if (dumpDir) {
  const flagged = [...new Set([...ruled, ...topJunk, ...bottomJunk, ...missingChoices, ...edgeCut])];
  let n = 0;
  for (const r of flagged) {
    if (n >= dumpLimit) break;
    if (!r.buf) continue;
    const reasons = [
      r.ruleRuns?.length ? "rule" : null,
      r.topJunk ? "top" : null,
      r.bottomJunk ? "bottom" : null,
      r.choiceMarks < r.choiceCount * r.numbers.length ? "choice" : null,
      r.edgeInk > EDGE_INK_LIMIT ? "edge" : null,
    ]
      .filter(Boolean)
      .join("-");
    fs.writeFileSync(
      path.join(dumpDir, `${reasons}_${r.path.replace(/[^\w.-]/g, "_")}.webp`),
      r.buf,
    );
    n++;
  }
  console.log(`\n표본 이미지 ${n}장을 ${dumpDir} 에 저장했다 — 반드시 눈으로 볼 것.`);
}

for (const r of results) delete r.buf;
fs.writeFileSync(outPath, JSON.stringify({ totalImages, checked: results.length, results }, null, 2));
console.log(`\n리포트: ${outPath}`);
