// 사용법: npm run backfill-question-image-width -- [--dry-run] [--concurrency 8] [--paper-id <uuid>]
//
// commit 167df71(문항 크롭 시 세로 여백만 제거하고 칼럼 폭은 유지) 이전에 크롭된
// question_images는 좌우까지 trim된 탓에, 선택지가 짧은 문항일수록 이미지 폭이
// 같은 문제지의 다른 문항보다 좁게 저장돼 있다. 프런트가 이미지를 컨테이너
// 폭(w-full)에 맞춰 늘리기 때문에, 이런 문항은 글씨가 유독 크게 표시된다.
//
// 이 스크립트는 전체 이미지를 다운로드하지 않고 WebP 헤더만 Range-read해서
// 폭을 확인한다(문제지당 수십~수백 개씩, 총 수만 개 이미지를 전부 받으면 느리고
// 비용이 크다). 같은 문제지 안에서 가장 넓은 이미지 폭을 "기준 폭"으로 삼고,
// 기준 폭의 80% 미만인 이미지만 버그로 간주해 좌우에 흰 여백을 더해 기준 폭에
// 맞춘다(내용을 늘리는 게 아니라 캔버스만 넓히므로 화질/비율 손실이 없다).
// 80% 임계값은 정상적인 trim 오차(수 px)와 실제 버그(약 2배 좁아짐)를 가르기
// 위한 값 — 단순 px 허용치는 정상 트림도 오탐한다.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const NARROW_RATIO_THRESHOLD = 0.8;
const RANGE_BYTES = 100; // VP8/VP8L/VP8X 헤더는 항상 30바이트 이내에 다 들어있다

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

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)}KB`;
}

// WebP RIFF 헤더에서 폭/높이만 뽑아낸다. sharp/libvips로 전체 디코드하지 않고
// 순수 바이트 파싱만 하므로 100바이트짜리 Range 응답만으로 충분하다.
function parseWebpDims(buf) {
  if (buf.length < 30) return null;
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const fourcc = buf.toString("ascii", 12, 16);
  if (fourcc === "VP8L") {
    const val = buf.readUInt32LE(21);
    return { width: (val & 0x3fff) + 1, height: ((val >> 14) & 0x3fff) + 1 };
  }
  if (fourcc === "VP8X") {
    return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
  }
  if (fourcc === "VP8 ") {
    return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

async function runPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  return results;
}

async function fetchAllRows(supabase, table, columns, filterFn) {
  const pageSize = 1000;
  const rows = [];
  let from = 0;
  for (;;) {
    let query = supabase.from(table).select(columns).order("id").range(from, from + pageSize - 1);
    if (filterFn) query = filterFn(query);
    const { data, error } = await query;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return rows;
}

async function fetchWidth(publicUrl, attempt = 0) {
  try {
    const res = await fetch(publicUrl, { headers: { Range: `bytes=0-${RANGE_BYTES - 1}` } });
    if (!res.ok && res.status !== 206) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const dims = parseWebpDims(buf);
    if (!dims) throw new Error("WebP 헤더 파싱 실패");
    return dims;
  } catch (err) {
    if (attempt < 2) return fetchWidth(publicUrl, attempt + 1);
    throw err;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const concurrency = args.concurrency ? Number(args.concurrency) : 8;
  const onlyPaperId = args["paper-id"];

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  console.log("question_images 전체 조회 중...");
  const rows = await fetchAllRows(supabase, "question_images", "id, image_path");
  console.log(`총 ${rows.length}개 행 조회 완료.`);

  // 경로 자체에 paperId가 들어있다(questions/<paperId>/<NN>.webp) — questions 테이블과
  // 조인할 필요 없이 바로 그룹핑할 수 있다. 세트문제는 여러 행이 같은 image_path를
  // 공유하니 경로 단위로 중복 제거해서 같은 이미지를 두 번 스캔/수정하지 않는다.
  const pathsByPaper = new Map(); // paperId -> Set<path>
  for (const row of rows) {
    const match = /^questions\/([^/]+)\//.exec(row.image_path);
    if (!match) continue;
    const paperId = match[1];
    if (onlyPaperId && paperId !== onlyPaperId) continue;
    if (!pathsByPaper.has(paperId)) pathsByPaper.set(paperId, new Set());
    pathsByPaper.get(paperId).add(row.image_path);
  }

  const uniquePaths = [...new Set([...pathsByPaper.values()].flatMap((s) => [...s]))];
  console.log(`문제지 ${pathsByPaper.size}개, 고유 이미지 ${uniquePaths.length}개. 폭 스캔 중(Range-read)...`);

  const widthByPath = new Map();
  const scanFailed = [];
  let scanned = 0;
  await runPool(uniquePaths, concurrency * 2, async (p) => {
    const { data } = supabase.storage.from("exam-papers").getPublicUrl(p);
    try {
      const dims = await fetchWidth(data.publicUrl);
      widthByPath.set(p, dims.width);
    } catch (err) {
      scanFailed.push({ path: p, error: err.message });
    }
    scanned++;
    if (scanned % 2000 === 0) console.log(`  ${scanned}/${uniquePaths.length} 스캔 완료`);
  });

  if (scanFailed.length > 0) {
    console.warn(`\n폭 스캔 실패 ${scanFailed.length}건(재시도 후에도 실패, 판정에서 제외):`);
    for (const f of scanFailed.slice(0, 20)) console.warn(`  ${f.path}: ${f.error}`);
  }

  // 문제지별 기준 폭(그 문제지 안에서 가장 넓은 이미지) 계산 후, 그 대비 80% 미만인
  // 이미지를 버그 후보로 표시한다.
  const candidates = []; // { paperId, path, width, referenceWidth, ratio }
  for (const [paperId, pathSet] of pathsByPaper) {
    const widths = [...pathSet].map((p) => widthByPath.get(p)).filter((w) => w !== undefined);
    if (widths.length < 2) continue; // 비교할 형제 이미지가 없으면 판정 불가
    const referenceWidth = Math.max(...widths);
    for (const p of pathSet) {
      const width = widthByPath.get(p);
      if (width === undefined) continue;
      const ratio = width / referenceWidth;
      if (ratio < NARROW_RATIO_THRESHOLD) {
        candidates.push({ paperId, path: p, width, referenceWidth, ratio });
      }
    }
  }

  candidates.sort((a, b) => a.ratio - b.ratio);
  console.log(
    `\n버그 후보 ${candidates.length}개 (문제지 ${new Set(candidates.map((c) => c.paperId)).size}개에 분포, 임계값 폭비율 < ${NARROW_RATIO_THRESHOLD}).`,
  );
  for (const c of candidates.slice(0, 30)) {
    console.log(`  ${c.path} : ${c.width}px / 기준 ${c.referenceWidth}px (비율 ${c.ratio.toFixed(2)})`);
  }
  if (candidates.length > 30) console.log(`  ... 외 ${candidates.length - 30}개`);

  if (dryRun) {
    const outDir = path.join(process.cwd(), "uploads", "width-backfill-preview");
    await mkdir(outDir, { recursive: true });
    await writeFile(
      path.join(outDir, "report.json"),
      JSON.stringify({ scannedImages: uniquePaths.length, scanFailed, candidates }, null, 2),
    );
    console.log(`\n[dry-run] Storage/DB는 건드리지 않았습니다. 상세 리포트: ${path.join(outDir, "report.json")}`);
    return;
  }

  if (candidates.length === 0) {
    console.log("고칠 이미지가 없습니다.");
    return;
  }

  console.log(`\n${candidates.length}개 이미지를 실제로 패딩합니다...`);
  let fixed = 0;
  let totalBefore = 0;
  let totalAfter = 0;
  const fixFailed = [];

  await runPool(candidates, concurrency, async (c) => {
    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from("exam-papers")
        .download(c.path);
      if (downloadError || !blob) throw new Error(downloadError?.message ?? "다운로드 실패");
      const buf = Buffer.from(await blob.arrayBuffer());
      const meta = await sharp(buf).metadata();
      const diff = c.referenceWidth - (meta.width ?? c.width);
      if (diff <= 0) return; // 이미 스캔 이후 다른 실행으로 고쳐졌거나 판정 오차
      const leftPad = Math.floor(diff / 2);
      const rightPad = diff - leftPad;
      const padded = await sharp(buf)
        .extend({ left: leftPad, right: rightPad, top: 0, bottom: 0, background: "#ffffff" })
        .webp({ lossless: true })
        .toBuffer();

      const { error: uploadError } = await supabase.storage
        .from("exam-papers")
        .upload(c.path, padded, { contentType: "image/webp", upsert: true });
      if (uploadError) throw new Error(uploadError.message);

      totalBefore += buf.length;
      totalAfter += padded.length;
      fixed++;
    } catch (err) {
      fixFailed.push({ path: c.path, error: err.message });
    }
  });

  console.log(`\n완료: ${fixed}/${candidates.length}개 수정, ${fixFailed.length}개 실패.`);
  if (fixed > 0) {
    console.log(`파일 크기: ${fmt(totalBefore)} -> ${fmt(totalAfter)}`);
  }
  if (fixFailed.length > 0) {
    console.error("실패 목록:");
    for (const f of fixFailed) console.error(`  ${f.path}: ${f.error}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
