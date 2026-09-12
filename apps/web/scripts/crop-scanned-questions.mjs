// 스캔본 문제지(텍스트 레이어 0자)를 OCR 로 읽어 문항 이미지로 자른다.
//
// 사용법:
//   node --env-file=.env.local scripts/crop-scanned-questions.mjs --exam-type 한능검 --level 심화 [--dry-run]
//   node --env-file=.env.local scripts/crop-scanned-questions.mjs --paper-ids ids.txt [--offset 0 --limit 5]
//
// `batch-crop-questions.mjs` 와 대상이 다르다: 그쪽은 텍스트 레이어가 있는 문제지,
// 이쪽은 **OCR 로 가짜 텍스트 레이어를 만들어야만** 자를 수 있는 스캔본이다
// (docs/agents/crop-question-images.md "텍스트 레이어가 없는 스캔 PDF"). 크롭·업로드
// 로직은 같은 함수를 쓰고, 입력만 scripts/lib/ocr-text-layer.mjs 가 만든다.
//
// **OCR 은 틀린다는 전제로 짰다.** 그래서 업로드 앞에 게이트가 둘이다:
//   (1) 인식 문항 수가 question_count 와 정확히 같을 것 (배치 공통 안전장치)
//   (2) **잘라낸 이미지에 실제로 찍힌 번호를 다시 읽어** 배정된 번호와 대조할 것
//       — (1)만으로는 "마커 하나를 놓치고 잡음 하나를 주워" 개수만 맞는 경우를
//       못 거른다. 이미지 왼쪽 위의 번호를 숫자 전용으로 다시 읽으면 그 어긋남이
//       바로 드러난다. 하나라도 어긋나면 그 문제지는 통째로 건너뛴다.
//
// 세트문제로 병합된 이미지는 (2)에서 제외한다 — 그 이미지는 번호가 아니라 안내문
// ("[49 ~ 50] 다음 자료를 …")으로 시작하기 때문이다. 대신 로그에 남겨 눈으로 본다.

import { createClient } from "@supabase/supabase-js";
import { createWorker, PSM } from "tesseract.js";
import fs from "node:fs";
import sharp from "sharp";
import { extractQuestionsFromPdf } from "./crop-question-images.mjs";
import { buildOcrTextLayer } from "./lib/ocr-text-layer.mjs";
import { QUESTION_IMAGE_UPLOAD_OPTIONS } from "./lib/question-image-upload.mjs";

const pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs");

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

async function fetchAllRows(supabase, table, columns, build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/**
 * 이미지 좌우 가장자리에 남은 **세로 실선**(칼럼 구분선·지면 테두리)을 지운다.
 *
 * 사용자 제보(50회 20번): 문항 이미지 왼쪽에 세로선이 한 줄 그대로 남았다. 스캔본은
 * 칼럼 구분선이 크롭 영역 안까지 들어오는데, 텍스트 레이어가 없어 본문 x 경계를
 * 정밀하게 못 잡기 때문이다.
 *
 * **잘라내지 않고 흰색으로 덮는다** — 문제지 한 장 안에서 이미지 폭은 모두 같아야
 * 하는데(docs/agents/crop-question-images.md), 잘라내면 그 폭이 문항마다 달라진다.
 * 가장자리 4% 안에서, 잉크 높이의 98% 이상을 채우는 열만 지운다: 지면을 관통하는
 * 실선은 정확히 1.0 이 되고 지문 상자 테두리는 발문·선지 때문에 1.0 이 못 된다
 * (실측 0.94 — 위 문서의 ruleCols 절).
 */
async function whitenEdgeRules(imageBuffer) {
  const { data, info } = await sharp(imageBuffer).greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  const colInk = new Array(width).fill(0);
  let inkTop = -1;
  let inkBottom = -1;
  for (let y = 0; y < height; y++) {
    let rowHasInk = false;
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] < 160) {
        colInk[x]++;
        rowHasInk = true;
      }
    }
    if (rowHasInk) {
      if (inkTop === -1) inkTop = y;
      inkBottom = y;
    }
  }
  const inkHeight = inkBottom - inkTop + 1;
  if (inkHeight <= 0) return imageBuffer;
  // 실측(50회 20번): 선이 왼쪽에서 7.4% 지점(1141px 중 x=84)에 있었다. 4% 창으로는
  // 못 잡아 12% 로 넓힌다. 대신 판정은 **잉크 높이 기준 95%** 로 좁게 — 지문 상자
  // 테두리는 위에 발문, 아래에 선지가 있어 잉크 높이를 다 채우지 못한다.
  const edge = Math.round(width * 0.12);
  const cuts = [];
  for (let x = 0; x < width; x++) {
    if (x > edge && x < width - edge) continue;
    if (colInk[x] / inkHeight >= 0.95) cuts.push(x);
  }
  if (cuts.length === 0) return imageBuffer;
  // 선 좌우 한 픽셀씩 여유를 두고 흰색으로 덮는다(선이 두 열에 걸쳐 번지는 경우).
  const rects = cuts.map((x) => ({
    input: {
      create: {
        width: Math.min(3, width - Math.max(0, x - 1)),
        height,
        channels: 3,
        background: "#ffffff",
      },
    },
    left: Math.max(0, x - 1),
    top: 0,
  }));
  return sharp(imageBuffer).composite(rects).webp({ lossless: true }).toBuffer();
}

/** 잘라낸 이미지 왼쪽 위에 찍힌 문항 번호를 숫자 전용으로 다시 읽는다. */
async function readPrintedNumber(imageBuffer, lineWorker) {
  const meta = await sharp(imageBuffer).metadata();
  const band = Math.max(30, Math.round(meta.height * 0.08));
  // **왼쪽 끝에서 고정 비율로 자르면 안 된다** — finalizeQuestionImage 가 내용을
  // 가로 한가운데로 옮기므로 이미지 왼쪽은 흰 여백이고, 거기만 잘라 읽으면 전부
  // "번호를 못 읽음"이 된다(실측: 50회 48건). 첫 줄의 **첫 잉크 자리**를 찾아
  // 거기서부터 잘라야 번호가 들어온다.
  const { data, info } = await sharp(imageBuffer)
    .extract({ left: 0, top: 0, width: meta.width, height: Math.min(band, meta.height) })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let inkX = -1;
  for (let y = 0; y < info.height && inkX !== 0; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[y * info.width + x] < 128) {
        if (inkX === -1 || x < inkX) inkX = x;
        break;
      }
    }
  }
  if (inkX === -1) return null;
  // 번호 뒤의 발문 첫 글자까지 함께 잘라 넣으면 읽기가 흔들린다(실측: "20" 을 90 으로,
  // "28" 을 1 로). 번호와 발문 사이에는 반드시 빈 칸이 있으므로, 첫 잉크부터 오른쪽으로
  // 훑다가 **밴드 높이의 0.35배 이상 비는 자리**에서 끊어 번호 글리프만 남긴다.
  const columnHasInk = new Array(info.width).fill(false);
  for (let y = 0; y < info.height; y++)
    for (let x = 0; x < info.width; x++)
      if (data[y * info.width + x] < 128) columnHasInk[x] = true;
  const gapPx = Math.max(6, Math.round(info.height * 0.35));
  let end = inkX;
  let run = 0;
  for (let x = inkX; x < info.width; x++) {
    if (columnHasInk[x]) {
      run = 0;
      end = x;
    } else if (++run >= gapPx) break;
  }
  const left = Math.max(0, inkX - 4);
  const width = Math.min(end - left + 6, meta.width - left);
  if (width <= 0) return null;
  const corner = await sharp(imageBuffer)
    .extract({ left, top: 0, width, height: Math.min(band, meta.height) })
    .resize({ width: width * 3 })
    .png()
    .toBuffer();
  const { data: ocr } = await lineWorker.recognize(corner);
  // 마침표 앞의 숫자만 번호다. 허용 목록에 "." 이 있어야 마침표가 0 으로 읽히지
  // 않는데(1. → "10"), 그러면 이번엔 마침표가 결과에 남으므로 여기서 잘라 읽는다.
  const m = /(\d{1,3})/.exec((ocr.text ?? "").replace(/\s/g, ""));
  return m ? Number(m[1]) : null;
}

async function cropOnePaper(supabase, paper, { dryRun, scale, worker, digitWorker, lineWorker, sweepWorker }) {
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(paper.file_path);
  if (downloadError || !fileBlob) return { paper, error: `PDF 다운로드 실패: ${downloadError?.message}` };
  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());

  const pdfjs = await pdfjsPromise;
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const textLayer = await buildOcrTextLayer(pdf, worker, {
    digitWorker,
    sweepWorker,
    expectedMarkerCount: paper.question_count ?? undefined,
  });

  let cropped;
  try {
    cropped = await extractQuestionsFromPdf(pdfBuffer, {
      scale,
      expectedCount: paper.question_count,
      textLayer,
    });
  } catch (err) {
    return { paper, error: `크롭 실패: ${err.message}` };
  }

  if (cropped.length === 0) return { paper, error: "OCR 후에도 문제 번호 마커를 못 찾음" };
  // 가장자리 세로 실선 제거는 개수 검사보다 먼저 해 둔다 — 아래 번호 대조가 이미지
  // 왼쪽 끝 잉크를 기준점으로 쓰는데, 실선이 남아 있으면 그 선을 번호로 착각한다.
  for (const c of cropped) c.image = await whitenEdgeRules(c.image);
  const expected = paper.question_count;
  if (expected && cropped.length !== expected)
    return { paper, error: `question_count=${expected}인데 ${cropped.length}개만 인식됨` };

  // 게이트 (2): 이미지에 찍힌 번호와 배정 번호 대조.
  //
  // **낱개 불일치를 그대로 실패로 보면 안 된다.** 이 대조 자체가 OCR 이라 작은
  // 크롭에서 심심찮게 틀린다(실측 50회: 크롭은 멀쩡한데 "20"을 90 으로, "28"을
  // 1 로 읽었다). 잡으려는 사고는 낱개 오독이 아니라 **번호가 통째로 밀리는 것**
  // (마커 하나를 놓치고 잡음 하나를 주워 개수만 맞는 경우)이므로, 읽힌 값들의
  // **어긋남(offset) 분포**를 본다: 0 이 과반이면 정렬이 맞은 것이고, 0 아닌 값이
  // 우세하면 통째로 밀린 것이라 실패로 막는다.
  const offsets = new Map();
  const samples = [];
  let readable = 0;
  for (const c of cropped) {
    if (c.groupNumbers) continue;
    const printed = await readPrintedNumber(c.image, lineWorker);
    if (printed === null || printed < 1 || printed > (expected ?? 999)) continue;
    readable++;
    const delta = printed - c.number;
    offsets.set(delta, (offsets.get(delta) ?? 0) + 1);
    if (delta !== 0) samples.push(`${c.number}번 자리에 ${printed}번`);
  }
  const verified = offsets.get(0) ?? 0;
  const merged = cropped.filter((c) => c.groupNumbers).map((c) => c.number);
  if (readable < 5)
    return { paper, error: `이미지에서 번호를 거의 못 읽어 대조 불가 (읽힘 ${readable}건)` };
  // 판정은 "0 이 과반인가"가 아니라 **"0 이 압도적 최빈값인가"** 로 한다. 대조용
  // OCR 의 오독은 여러 값으로 흩어지는 반면(74회: 0 이 11건, 나머지는 제각각),
  // 번호가 진짜로 밀리면 한 값에 뭉친다(61회: +2 칸이 10건). 과반을 요구하면
  // 대조 잡음이 심한 회차가 통째로 막히고, 최빈값만 보면 밀림을 놓친다.
  // **읽힌 것만 보면 안 된다.** 74회는 "읽힌 27건 중 11건 일치"로 이 검사를 통과했는데,
  // 실제로는 문항 절반의 이미지가 발문 줄을 잃은 채(자료 그림부터 시작) 올라갔다 —
  // 번호가 아예 안 찍힌 이미지는 "못 읽음"으로 빠져나가기 때문이다. 그래서 전체 문항
  // 대비 일치율도 함께 본다: 크롭이 제대로면 대부분의 이미지가 번호로 시작한다
  // (실측 50회 37/50 = 74%, 망가진 74회 11/50 = 22%).
  const singles = cropped.filter((c) => !c.groupNumbers).length;
  if (verified < singles * 0.6) {
    return {
      paper,
      error: `이미지가 번호로 시작하지 않는 것이 많음 (일치 ${verified}/${singles}) — 크롭 상단 경계 확인 필요`,
    };
  }
  const worstNonZero = [...offsets.entries()]
    .filter(([delta]) => delta !== 0)
    .sort((a, b) => b[1] - a[1])[0];
  if (verified < 3 * (worstNonZero?.[1] ?? 0)) {
    return {
      paper,
      error:
        `이미지 번호가 통째로 어긋남 (일치 ${verified}/${readable}, 최다 어긋남 ${worstNonZero[0]}칸 ${worstNonZero[1]}건): ` +
        samples.slice(0, 5).join(", "),
    };
  }

  if (dryRun) return { paper, cropped: cropped.length, verified, merged, dryRun: true };

  const uploadedPaths = new Set();
  let uploaded = 0;
  for (const c of cropped) {
    const groupStart = Math.min(...(c.groupNumbers ?? [c.number]));
    const storagePath = `questions/${paper.id}/${String(groupStart).padStart(2, "0")}.webp`;
    if (!uploadedPaths.has(storagePath)) {
      const { error: uploadError } = await supabase.storage
        .from("exam-papers")
        .upload(storagePath, c.image, QUESTION_IMAGE_UPLOAD_OPTIONS);
      if (uploadError) return { paper, error: `${c.number}번 업로드 실패: ${uploadError.message}` };
      uploadedPaths.add(storagePath);
    }
    const { data: questionRow, error: questionError } = await supabase
      .from("questions")
      .upsert(
        { paper_id: paper.id, question_number: c.number, choice_count: paper.choice_count ?? 4 },
        { onConflict: "paper_id,question_number" },
      )
      .select("id")
      .single();
    if (questionError || !questionRow)
      return { paper, error: `${c.number}번 questions upsert 실패: ${questionError?.message}` };
    const { error: imageError } = await supabase
      .from("question_images")
      .upsert(
        { question_id: questionRow.id, order_index: 0, image_path: storagePath },
        { onConflict: "question_id,order_index" },
      );
    if (imageError) return { paper, error: `${c.number}번 question_images upsert 실패: ${imageError.message}` };
    uploaded++;
  }
  return { paper, cropped: cropped.length, uploaded, verified, merged };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const scale = args.scale ? Number(args.scale) : 3;
  const offset = args.offset ? Number(args.offset) : 0;
  const limit = args.limit ? Number(args.limit) : undefined;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  let papers = await fetchAllRows(
    supabase,
    "exam_papers",
    "id, title, year, round, level, file_path, question_count, choice_count, exam_type_id",
  );

  if (args["paper-ids"]) {
    const ids = new Set(
      fs.readFileSync(args["paper-ids"], "utf8").split(/\s+/).map((s) => s.trim()).filter(Boolean),
    );
    papers = papers.filter((p) => ids.has(p.id));
  } else if (args["exam-type"]) {
    const { data: examTypes } = await supabase.from("exam_types").select("id, name");
    const examType = examTypes.find((t) => t.name === args["exam-type"]);
    if (!examType) {
      console.error(`시험 종류를 찾을 수 없습니다: ${args["exam-type"]}`);
      process.exit(1);
    }
    papers = papers.filter((p) => p.exam_type_id === examType.id);
    if (typeof args.level === "string") papers = papers.filter((p) => p.level === args.level);
  } else {
    console.error("--exam-type 또는 --paper-ids 가 필요합니다.");
    process.exit(1);
  }

  papers = papers.filter((p) => p.file_path).sort((a, b) => a.id.localeCompare(b.id));
  if (offset) papers = papers.slice(offset);
  if (limit) papers = papers.slice(0, limit);

  console.log(`대상 ${papers.length}개 (scale ${scale}${dryRun ? ", dry-run" : ""})\n`);

  // 워커는 한 번만 만든다 — 언어 데이터 로딩이 붙어 문제지마다 만들면 그만큼 느려진다.
  const worker = await createWorker("kor+eng", 1, { cachePath: ".ocr-cache" });
  // 검증용 워커는 PSM 이 다르다. 이미지 왼쪽 위 크롭에는 번호 말고도 발문 첫
  // 글자가 같이 들어오는데, SINGLE_WORD 는 그런 입력에서 **빈 결과**를 낸다
  // (실측: 6·7·8·11번이 전부 "번호를 못 읽음"으로 보고됐다). 한 줄로 읽힌다.
  const lineWorker = await createWorker("eng", 1, { cachePath: ".ocr-cache" });
  await lineWorker.setParameters({
    tessedit_char_whitelist: "0123456789.",
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  });
  // 마커 열 훑기용: 숫자만, 흩어진 글자 모드(SPARSE_TEXT).
  const sweepWorker = await createWorker("eng", 1, { cachePath: ".ocr-cache" });
  await sweepWorker.setParameters({
    tessedit_char_whitelist: "0123456789.",
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
  });
  const digitWorker = await createWorker("eng", 1, { cachePath: ".ocr-cache" });
  await digitWorker.setParameters({
    // 마침표를 허용 목록에 넣는다 — 빼면 "1." 의 마침표가 0 으로 읽혀 "10" 이 된다
    // (실측: 1·2·3·5번 자리가 각각 10·20·30·50 으로 보고됐다).
    tessedit_char_whitelist: "0123456789.",
    tessedit_pageseg_mode: PSM.SINGLE_WORD,
  });

  const failures = [];
  let done = 0;
  try {
    for (const paper of papers) {
      const startedAt = Date.now();
      const result = await cropOnePaper(supabase, paper, { dryRun, scale, worker, digitWorker, lineWorker, sweepWorker });
      const label = `${paper.title} id=${paper.id}`;
      const secs = ((Date.now() - startedAt) / 1000).toFixed(0);
      if (result.error) {
        failures.push(`${label}: ${result.error}`);
        console.error(`[${++done}/${papers.length}] 실패: ${label} - ${result.error} (${secs}초)`);
      } else {
        console.log(
          `[${++done}/${papers.length}] 완료: ${label} - ${result.uploaded ?? result.cropped}/${result.cropped}개, 번호 일치 ${result.verified}건` +
            `${result.merged?.length ? `, 세트 병합 ${result.merged.join(",")}` : ""} (${secs}초)`,
        );
      }
    }
  } finally {
    await worker.terminate();
    await digitWorker.terminate();
    await lineWorker.terminate();
    await sweepWorker.terminate();
  }

  console.log(`\n=== 요약 ===\n성공: ${papers.length - failures.length}개, 실패: ${failures.length}개`);
  if (failures.length) {
    console.log("\n[실패 — 수동 확인 필요]");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
