// 사용법: node --env-file=.env.local scripts/backup-storage.mjs
//
// Storage(exam-papers 버킷)의 PDF/이미지 원본을 같은 프로젝트 안의 별도 버킷
// (exam-papers-backup)으로 복제한다. 배포 후에는 src/app/api/cron/backup-storage/route.ts를
// Vercel Cron이 매일 자동 호출하므로 평소엔 이 스크립트를 직접 돌릴 필요는 없다 —
// 이건 그 크론과 같은 로직을 로컬에서 수동으로 확인/최초 백필할 때 쓰는 용도.
//
// 복사만 하고 절대 삭제하지 않는다: 원본이 실수로 지워져도 백업 버킷의 사본은 남아야
// 의미가 있다. 경로가 이미 백업에 있고 크기도 같으면 건너뛴다.

import { createClient } from "@supabase/supabase-js";

const SOURCE_BUCKET = "exam-papers";
const BACKUP_BUCKET = "exam-papers-backup";
const PAGE_SIZE = 1000;

async function listAllFiles(supabase, bucket, prefix = "") {
  const files = [];
  let offset = 0;
  while (true) {
    const { data, error } = await supabase.storage
      .from(bucket)
      .list(prefix, { limit: PAGE_SIZE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(`list(${bucket}/${prefix}): ${error.message}`);
    if (!data || data.length === 0) break;

    for (const entry of data) {
      const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null) {
        files.push(...(await listAllFiles(supabase, bucket, fullPath)));
      } else {
        files.push({ path: fullPath, size: entry.metadata?.size });
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return files;
}

async function ensureBackupBucket(supabase) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);
  if (buckets?.some((b) => b.name === BACKUP_BUCKET)) return;

  console.log(`백업 버킷이 없어 새로 만듭니다: ${BACKUP_BUCKET}`);
  const { error: createError } = await supabase.storage.createBucket(BACKUP_BUCKET, {
    public: false,
  });
  if (createError && !createError.message.includes("already exists")) {
    throw new Error(`createBucket: ${createError.message}`);
  }
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  await ensureBackupBucket(supabase);

  console.log("파일 목록을 가져오는 중...");
  const [sourceFiles, backupFiles] = await Promise.all([
    listAllFiles(supabase, SOURCE_BUCKET),
    listAllFiles(supabase, BACKUP_BUCKET),
  ]);
  console.log(`원본 ${sourceFiles.length}개, 백업 ${backupFiles.length}개`);

  const backupByPath = new Map(backupFiles.map((f) => [f.path, f]));
  const toCopy = sourceFiles.filter((f) => {
    const existing = backupByPath.get(f.path);
    return !existing || existing.size !== f.size;
  });
  console.log(`복사 필요: ${toCopy.length}개 (나머지는 이미 백업됨)`);

  let copied = 0;
  const failed = [];
  for (const file of toCopy) {
    const { error } = await supabase.storage
      .from(SOURCE_BUCKET)
      .copy(file.path, file.path, { destinationBucket: BACKUP_BUCKET });
    if (error) {
      failed.push(`${file.path}: ${error.message}`);
      console.error(`  실패: ${file.path} - ${error.message}`);
    } else {
      copied++;
      if (copied % 20 === 0) console.log(`  ${copied}/${toCopy.length} 복사됨...`);
    }
  }

  console.log(`\n백업 완료 — 복사 ${copied}개, 실패 ${failed.length}개`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
