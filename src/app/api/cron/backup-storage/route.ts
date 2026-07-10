import { createAdminClient } from "@/lib/supabase/admin";

// Storage(exam-papers 버킷)의 PDF/이미지 원본을 같은 프로젝트 안의 별도 버킷
// (exam-papers-backup)으로 복제하는 크론. Supabase의 daily backup은 DB 메타데이터만
// 포함하고 Storage의 실제 파일 바이트는 포함하지 않으므로, 실수로 파일이 삭제/덮어써진
// 경우를 대비해 이 크론으로 따로 복제해둔다.
// - 복사만 하고 절대 삭제하지 않는다: 원본이 지워져도 백업 버킷의 사본은 남아야 의미가 있다.
// - 경로가 이미 백업에 있고 크기도 같으면 건너뛴다(매일 전체를 다시 복사하지 않기 위해).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE_BUCKET = "exam-papers";
const BACKUP_BUCKET = "exam-papers-backup";
const PAGE_SIZE = 1000;

type SupabaseAdmin = ReturnType<typeof createAdminClient>;
type FileEntry = { path: string; size: number | undefined };

async function listAllFiles(
  supabase: SupabaseAdmin,
  bucket: string,
  prefix = "",
): Promise<FileEntry[]> {
  const files: FileEntry[] = [];
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
        // 폴더(파일이 아님) — 재귀적으로 내려간다.
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

async function ensureBackupBucket(supabase: SupabaseAdmin) {
  const { data: buckets, error } = await supabase.storage.listBuckets();
  if (error) throw new Error(`listBuckets: ${error.message}`);
  if (buckets?.some((b) => b.name === BACKUP_BUCKET)) return;

  const { error: createError } = await supabase.storage.createBucket(BACKUP_BUCKET, {
    public: false,
  });
  if (createError && !createError.message.includes("already exists")) {
    throw new Error(`createBucket: ${createError.message}`);
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const supabase = createAdminClient();
  await ensureBackupBucket(supabase);

  const [sourceFiles, backupFiles] = await Promise.all([
    listAllFiles(supabase, SOURCE_BUCKET),
    listAllFiles(supabase, BACKUP_BUCKET),
  ]);

  const backupByPath = new Map(backupFiles.map((f) => [f.path, f]));
  const toCopy = sourceFiles.filter((f) => {
    const existing = backupByPath.get(f.path);
    return !existing || existing.size !== f.size;
  });

  let copied = 0;
  const failed: string[] = [];
  for (const file of toCopy) {
    const { error } = await supabase.storage
      .from(SOURCE_BUCKET)
      .copy(file.path, file.path, { destinationBucket: BACKUP_BUCKET });
    if (error) {
      failed.push(`${file.path}: ${error.message}`);
    } else {
      copied++;
    }
  }

  return Response.json({
    ok: failed.length === 0,
    at: new Date().toISOString(),
    sourceFiles: sourceFiles.length,
    alreadyBackedUp: sourceFiles.length - toCopy.length,
    copied,
    failed,
  });
}
