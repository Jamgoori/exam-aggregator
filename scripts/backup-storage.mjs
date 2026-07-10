// 사용법: node --env-file=.env.local scripts/backup-storage.mjs
//
// Storage(exam-papers 버킷)의 PDF/이미지 원본을 Cloudflare R2로 복제한다. 배포 후에는
// src/app/api/cron/backup-storage/route.ts를 Vercel Cron이 매일 자동 호출하므로 평소엔
// 이 스크립트를 직접 돌릴 필요는 없다 — 이건 그 크론과 같은 로직을 로컬에서 수동으로
// 확인/최초 백필할 때 쓰는 용도(파일이 많으면 크론의 60초 제한에 걸릴 수 있어서, 처음
// 한 번은 이 스크립트로 미리 채워두는 걸 추천).
//
// 복사만 하고 절대 삭제하지 않는다: 원본이 실수로 지워져도 R2의 사본은 남아야 의미가
// 있다. 경로가 이미 R2에 있고 크기도 같으면 건너뛴다.
//
// 필요한 환경변수: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
// (Cloudflare 대시보드 > R2 > Manage API Tokens 에서 발급)

import { createClient } from "@supabase/supabase-js";
import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";

const SOURCE_BUCKET = "exam-papers";
const PAGE_SIZE = 1000;

async function listSupabaseFiles(supabase, bucket, prefix = "") {
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
        files.push(...(await listSupabaseFiles(supabase, bucket, fullPath)));
      } else {
        files.push({ path: fullPath, size: entry.metadata?.size });
      }
    }
    if (data.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return files;
}

async function listR2Files(s3, bucket) {
  const files = new Map();
  let continuationToken;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) files.set(obj.Key, obj.Size ?? 0);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return files;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;
  if (!supabaseUrl || !serviceRoleKey || !accountId || !accessKeyId || !secretAccessKey || !bucket) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME이 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });

  console.log("파일 목록을 가져오는 중...");
  const [sourceFiles, r2Files] = await Promise.all([
    listSupabaseFiles(supabase, SOURCE_BUCKET),
    listR2Files(s3, bucket),
  ]);
  console.log(`원본 ${sourceFiles.length}개, R2에 이미 ${r2Files.size}개`);

  const toCopy = sourceFiles.filter((f) => {
    const existingSize = r2Files.get(f.path);
    return existingSize === undefined || existingSize !== f.size;
  });
  console.log(`복사 필요: ${toCopy.length}개 (나머지는 이미 백업됨)`);

  let copied = 0;
  const failed = [];
  for (const file of toCopy) {
    try {
      const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(file.path);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      const buffer = Buffer.from(await data.arrayBuffer());
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: file.path, Body: buffer }));
      copied++;
      if (copied % 20 === 0) console.log(`  ${copied}/${toCopy.length} 복사됨...`);
    } catch (err) {
      failed.push(`${file.path}: ${err.message}`);
      console.error(`  실패: ${file.path} - ${err.message}`);
    }
  }

  console.log(`\n백업 완료 — 복사 ${copied}개, 실패 ${failed.length}개`);
  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
