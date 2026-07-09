// 사용법: npm run migrate-pdfs -- [--dry-run] [--concurrency 4]
//
// uploadExamPaper/bulk-upload/upload-answer가 이제 업로드 시점에 PDF를 무손실
// 최적화하지만, 이미 올라가 있는 exam_papers/answer_keys의 PDF는 그대로다.
// 이 스크립트가 그 기존 파일들을 같은 방식(object stream 재정리)으로 한 번에
// 정리한다. 경로(file_path)는 그대로 두고 같은 자리에 덮어쓰며, 더 작아진
// 경우에만 실제로 반영한다(줄지 않으면 원본을 그대로 둔다).

import { createClient } from "@supabase/supabase-js";
import { optimizePdf } from "./lib/optimize-pdf.mjs";
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

async function migrateOne(supabase, table, row, dryRun) {
  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(row.file_path);
  if (downloadError || !fileBlob) {
    return { error: `다운로드 실패: ${downloadError?.message}`, id: row.id, path: row.file_path };
  }
  const original = Buffer.from(await fileBlob.arrayBuffer());
  const optimized = await optimizePdf(original);

  if (optimized.byteLength >= original.byteLength) {
    return { skipped: true, id: row.id, path: row.file_path, originalSize: original.byteLength };
  }

  if (dryRun) {
    return {
      id: row.id,
      path: row.file_path,
      originalSize: original.byteLength,
      optimizedSize: optimized.byteLength,
    };
  }

  const { error: uploadError } = await supabase.storage
    .from("exam-papers")
    .upload(row.file_path, optimized, { contentType: "application/pdf", upsert: true });
  if (uploadError) {
    return { error: `업로드 실패: ${uploadError.message}`, id: row.id, path: row.file_path };
  }

  const { error: updateError } = await supabase
    .from(table)
    .update({ file_size: optimized.byteLength })
    .eq("id", row.id);
  if (updateError) {
    return { error: `DB 갱신 실패: ${updateError.message}`, id: row.id, path: row.file_path };
  }

  return {
    id: row.id,
    path: row.file_path,
    originalSize: original.byteLength,
    optimizedSize: optimized.byteLength,
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

async function migrateTable(supabase, table, dryRun, concurrency) {
  let rows;
  try {
    rows = await fetchAllRows(() => supabase.from(table).select("id, file_path"));
  } catch (error) {
    console.error(`${table} 조회 실패: ${error.message}`);
    return { succeeded: [], errors: [] };
  }
  if (!rows || rows.length === 0) {
    console.log(`[${table}] 대상 없음.`);
    return { succeeded: [], errors: [] };
  }

  console.log(`[${table}] 대상: ${rows.length}개${dryRun ? " (dry-run)" : ""}`);
  const results = await runPool(rows, concurrency, (row) => migrateOne(supabase, table, row, dryRun));

  const errors = results.filter((r) => r?.error);
  const skipped = results.filter((r) => r?.skipped);
  const succeeded = results.filter((r) => r && !r.error && !r.skipped);

  for (const r of errors) {
    console.error(`  실패: ${r.path} (id=${r.id}) - ${r.error}`);
  }

  const totalBefore = succeeded.reduce((s, r) => s + r.originalSize, 0);
  const totalAfter = succeeded.reduce((s, r) => s + r.optimizedSize, 0);

  console.log(
    `[${table}] ${dryRun ? "[dry-run] " : ""}완료: ${succeeded.length}개 절감, ${skipped.length}개 이미 최적(건너뜀), ${errors.length}개 실패`,
  );
  if (succeeded.length > 0) {
    const reduction = (1 - totalAfter / totalBefore) * 100;
    console.log(`  ${fmt(totalBefore)} → ${fmt(totalAfter)} (${reduction.toFixed(1)}% 감소)`);
  }

  return { succeeded, errors };
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

  const papers = await migrateTable(supabase, "exam_papers", dryRun, concurrency);
  const answers = await migrateTable(supabase, "answer_keys", dryRun, concurrency);

  const totalBefore =
    [...papers.succeeded, ...answers.succeeded].reduce((s, r) => s + r.originalSize, 0);
  const totalAfter =
    [...papers.succeeded, ...answers.succeeded].reduce((s, r) => s + r.optimizedSize, 0);
  const totalErrors = papers.errors.length + answers.errors.length;

  console.log(`\n=== 합계 ===`);
  if (totalBefore > 0) {
    console.log(`${fmt(totalBefore)} → ${fmt(totalAfter)} (${((1 - totalAfter / totalBefore) * 100).toFixed(1)}% 감소)`);
  }
  console.log(`실패: ${totalErrors}개`);
  if (dryRun) {
    console.log("\ndry-run이라 Storage/DB는 건드리지 않았습니다. 실제로 적용하려면 --dry-run 없이 다시 실행하세요.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
