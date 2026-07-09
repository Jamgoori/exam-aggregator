import { createAdminClient } from "@/lib/supabase/admin";
import { optimizePdf } from "@/lib/optimize-pdf";
import { optimizeQuestionImage } from "@/lib/optimize-question-image";
import { runWithConcurrency } from "@/lib/concurrency";

// 이미 업로드된 PDF/문항 이미지 백로그를 조금씩 갈아넣는 크론(vercel.json이 주기
// 호출). 한 번 호출당 아래 배치 크기만큼만 처리해서 서버리스 함수 실행시간 제한
// 안에 항상 끝나게 하고, 처리 다 되면(대상 0건) 이후로는 사실상 아무 일도 안 하는
// 빈 호출이 된다 — 그래서 계속 켜둬도 안전하다.
//
// PDF는 exam_papers/answer_keys의 pdf_optimized_at이 null인 행만 골라 처리하고,
// 처리 후(더 안 줄었어도) 그 시각을 채워 다시는 같은 파일을 재확인하지 않는다.
// 이미지는 image_path가 아직 .png인 행 자체가 "안 끝난 것"의 표시라 별도 컬럼이
// 필요 없다.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PDF_BATCH_PER_TABLE = 25;
const IMAGE_BATCH = 40;
const CONCURRENCY = 5;

async function optimizePdfBatch(
  admin: ReturnType<typeof createAdminClient>,
  table: "exam_papers" | "answer_keys",
) {
  const { data: rows, error } = await admin
    .from(table)
    .select("id, file_path")
    .is("pdf_optimized_at", null)
    .order("id")
    .limit(PDF_BATCH_PER_TABLE);

  if (error) return { table, error: error.message, processed: 0, shrunk: 0, failed: 0 };
  if (!rows || rows.length === 0) return { table, processed: 0, shrunk: 0, failed: 0 };

  let shrunk = 0;
  let failed = 0;

  await runWithConcurrency(
    rows as { id: string; file_path: string }[],
    CONCURRENCY,
    async (row) => {
      const { data: fileBlob, error: downloadError } = await admin.storage
        .from("exam-papers")
        .download(row.file_path);
      if (downloadError || !fileBlob) {
        failed++;
        return;
      }
      const original = Buffer.from(await fileBlob.arrayBuffer());
      const optimized = await optimizePdf(original);

      if (optimized.byteLength < original.byteLength) {
        const { error: uploadError } = await admin.storage
          .from("exam-papers")
          .upload(row.file_path, optimized, { contentType: "application/pdf", upsert: true });
        if (uploadError) {
          failed++;
          return;
        }
        await admin
          .from(table)
          .update({ file_size: optimized.byteLength, pdf_optimized_at: new Date().toISOString() })
          .eq("id", row.id);
        shrunk++;
      } else {
        // 더 줄지는 않지만 확인은 끝났으니 다음 호출에서 다시 안 걸리게 표시.
        await admin
          .from(table)
          .update({ pdf_optimized_at: new Date().toISOString() })
          .eq("id", row.id);
      }
    },
  );

  return { table, processed: rows.length, shrunk, failed };
}

async function optimizeImageBatch(admin: ReturnType<typeof createAdminClient>) {
  const { data: rows, error } = await admin
    .from("question_images")
    .select("id, image_path")
    .ilike("image_path", "%.png")
    .order("id")
    .limit(IMAGE_BATCH);

  if (error) return { error: error.message, processed: 0, converted: 0, failed: 0 };
  if (!rows || rows.length === 0) return { processed: 0, converted: 0, failed: 0 };

  const results = await runWithConcurrency(
    rows as { id: string; image_path: string }[],
    CONCURRENCY,
    (row) => optimizeQuestionImage(admin, row),
  );

  const converted = results.filter((r) => r.ok).length;
  const failed = results.length - converted;

  return { processed: rows.length, converted, failed };
}

export async function GET(request: Request) {
  // 이 엔드포인트는 service role로 DB/Storage를 직접 바꾸므로, warm 크론과 달리
  // CRON_SECRET 미설정 시 열어두지 않고 항상 막는다.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return new Response("CRON_SECRET not configured", { status: 500 });
  }
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = createAdminClient();

  const [examPapers, answerKeys, images] = await Promise.all([
    optimizePdfBatch(admin, "exam_papers"),
    optimizePdfBatch(admin, "answer_keys"),
    optimizeImageBatch(admin),
  ]);

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    pdfs: { examPapers, answerKeys },
    images,
  });
}
