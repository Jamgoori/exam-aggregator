// 사용법: npm run migrate-question-images -- [--dry-run] [--concurrency 4]
//
// crop-question-images.mjs를 WebP 무손실로 바꾸기 전에 이미 PNG로 저장돼 있던
// question_images를 일괄 변환한다. 각 행에 대해:
//   1. 기존 PNG를 Storage에서 내려받아 WebP 무손실로 다시 인코딩
//   2. 같은 파일명에서 확장자만 .webp로 바꾼 새 경로로 업로드
//   3. question_images.image_path를 새 경로로 갱신
//   4. 성공 확인 후 기존 PNG 오브젝트를 삭제
// image_path가 이미 .png가 아닌 행(재실행 시 이미 변환된 행 등)은 건너뛴다.

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { fetchAllRows } from "./lib/fetch-all.mjs";

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

async function migrateOne(supabase, row, dryRun) {
  const oldPath = row.image_path;
  if (!oldPath.toLowerCase().endsWith(".png")) {
    return { skipped: true, id: row.id };
  }
  const newPath = oldPath.replace(/\.png$/i, ".webp");

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(oldPath);
  if (downloadError || !fileBlob) {
    return { error: `다운로드 실패: ${downloadError?.message}`, id: row.id, path: oldPath };
  }
  const pngBuffer = Buffer.from(await fileBlob.arrayBuffer());
  const webpBuffer = await sharp(pngBuffer).webp({ lossless: true }).toBuffer();

  if (dryRun) {
    return {
      id: row.id,
      path: oldPath,
      pngSize: pngBuffer.length,
      webpSize: webpBuffer.length,
    };
  }

  const { error: uploadError } = await supabase.storage
    .from("exam-papers")
    .upload(newPath, webpBuffer, { contentType: "image/webp", upsert: true });
  if (uploadError) {
    return { error: `업로드 실패: ${uploadError.message}`, id: row.id, path: oldPath };
  }

  const { error: updateError } = await supabase
    .from("question_images")
    .update({ image_path: newPath })
    .eq("id", row.id);
  if (updateError) {
    // DB 갱신이 실패하면 새로 올린 webp는 고아 오브젝트가 되니 정리하고, 기존
    // PNG는 그대로 남겨서(image_path가 여전히 .png를 가리키니) 서비스에 지장이 없게 한다.
    await supabase.storage.from("exam-papers").remove([newPath]);
    return { error: `DB 갱신 실패: ${updateError.message}`, id: row.id, path: oldPath };
  }

  const { error: removeError } = await supabase.storage
    .from("exam-papers")
    .remove([oldPath]);
  if (removeError) {
    // DB는 이미 새 경로를 가리키므로 서비스에는 지장 없다 — 남은 PNG는 나중에 수동 정리.
    console.warn(`  (참고) 기존 PNG 삭제 실패: ${oldPath} - ${removeError.message}`);
  }

  return {
    id: row.id,
    path: oldPath,
    newPath,
    pngSize: pngBuffer.length,
    webpSize: webpBuffer.length,
  };
}

// 여러 행을 concurrency만큼 동시에 처리하는 간단한 워커 풀.
async function runPool(items, concurrency, worker) {
  const results = [];
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => runNext()));
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryRun = Boolean(args["dry-run"]);
  const concurrency = args.concurrency ? Number(args.concurrency) : 4;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let rows;
  try {
    rows = await fetchAllRows(() =>
      supabase.from("question_images").select("id, image_path").ilike("image_path", "%.png"),
    );
  } catch (error) {
    console.error(`question_images 조회 실패: ${error.message}`);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log("변환할 PNG 이미지가 없습니다 (이미 전부 WebP거나 데이터가 없음).");
    return;
  }

  console.log(`대상: ${rows.length}개${dryRun ? " (dry-run — 실제 변경 없음)" : ""}`);

  const results = await runPool(rows, concurrency, (row) => migrateOne(supabase, row, dryRun));

  const errors = results.filter((r) => r?.error);
  const succeeded = results.filter((r) => r && !r.error && !r.skipped);

  for (const r of errors) {
    console.error(`실패: ${r.path} (id=${r.id}) - ${r.error}`);
  }

  const totalPng = succeeded.reduce((s, r) => s + r.pngSize, 0);
  const totalWebp = succeeded.reduce((s, r) => s + r.webpSize, 0);

  console.log(`\n${dryRun ? "[dry-run] " : ""}완료: ${succeeded.length}/${rows.length}개 성공, ${errors.length}개 실패`);
  if (succeeded.length > 0) {
    const reduction = (1 - totalWebp / totalPng) * 100;
    console.log(`PNG 총합:   ${fmt(totalPng)}`);
    console.log(`WebP 총합:  ${fmt(totalWebp)} (${reduction.toFixed(1)}% 감소)`);
  }
  if (dryRun) {
    console.log("\ndry-run이라 Storage/DB는 건드리지 않았습니다. 실제로 적용하려면 --dry-run 없이 다시 실행하세요.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
