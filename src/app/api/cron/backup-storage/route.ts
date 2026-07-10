import { S3Client, ListObjectsV2Command, PutObjectCommand } from "@aws-sdk/client-s3";
import { createAdminClient } from "@/lib/supabase/admin";

// Storage(exam-papers 버킷)의 PDF/이미지 원본을 Cloudflare R2로 복제하는 크론.
// Supabase의 daily backup은 DB 메타데이터만 포함하고 Storage의 실제 파일 바이트는
// 포함하지 않으므로, Supabase 프로젝트 자체에 문제가 생겨도 살아남도록 완전히 별도
// 서비스(R2)에 사본을 둔다.
// - 복사만 하고 절대 삭제하지 않는다: 원본이 지워져도 R2의 사본은 남아야 의미가 있다.
// - 경로가 이미 R2에 있고 크기도 같으면 건너뛴다(매일 전체를 다시 옮기지 않기 위해).
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SOURCE_BUCKET = "exam-papers";
const PAGE_SIZE = 1000;

type SupabaseAdmin = ReturnType<typeof createAdminClient>;
type FileEntry = { path: string; size: number | undefined };

function getR2Client() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY 환경변수가 필요합니다.",
    );
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function listSupabaseFiles(
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

async function listR2Files(s3: S3Client, bucket: string): Promise<Map<string, number>> {
  const files = new Map<string, number>();
  let continuationToken: string | undefined;
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

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const bucket = process.env.R2_BUCKET_NAME;
  if (!bucket) {
    return Response.json({ ok: false, error: "R2_BUCKET_NAME 환경변수가 필요합니다." }, { status: 500 });
  }

  const supabase = createAdminClient();
  const s3 = getR2Client();

  const [sourceFiles, r2Files] = await Promise.all([
    listSupabaseFiles(supabase, SOURCE_BUCKET),
    listR2Files(s3, bucket),
  ]);

  const toCopy = sourceFiles.filter((f) => {
    const existingSize = r2Files.get(f.path);
    return existingSize === undefined || existingSize !== f.size;
  });

  let copied = 0;
  const failed: string[] = [];
  for (const file of toCopy) {
    try {
      const { data, error } = await supabase.storage.from(SOURCE_BUCKET).download(file.path);
      if (error || !data) throw new Error(error?.message ?? "download failed");
      const buffer = Buffer.from(await data.arrayBuffer());
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: file.path, Body: buffer }));
      copied++;
    } catch (err) {
      failed.push(`${file.path}: ${err instanceof Error ? err.message : String(err)}`);
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
