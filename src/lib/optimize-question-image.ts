import "server-only";
import sharp from "sharp";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type OptimizeImageResult =
  | { ok: true; id: string; pngSize: number; webpSize: number }
  | { ok: false; id: string; error: string };

// scripts/migrate-question-images-to-webp.mjs와 같은 로직의 TS 버전 — 크론
// 라우트(api/cron/optimize-storage)에서 재사용한다. 기존 PNG 문항 이미지 한 건을
// WebP 무손실로 바꾼다: 다운로드 → 재인코딩 → 새 경로 업로드 → DB 경로 갱신 →
// 기존 PNG 삭제. 실패해도 서비스에 지장이 없도록 각 단계에서 안전하게 되돌린다.
export async function optimizeQuestionImage(
  admin: AdminClient,
  row: { id: string; image_path: string },
): Promise<OptimizeImageResult> {
  const oldPath = row.image_path;
  const newPath = oldPath.replace(/\.png$/i, ".webp");

  const { data: fileBlob, error: downloadError } = await admin.storage
    .from("exam-papers")
    .download(oldPath);
  if (downloadError || !fileBlob) {
    return { ok: false, id: row.id, error: `다운로드 실패: ${downloadError?.message}` };
  }
  const pngBuffer = Buffer.from(await fileBlob.arrayBuffer());
  const webpBuffer = await sharp(pngBuffer).webp({ lossless: true }).toBuffer();

  const { error: uploadError } = await admin.storage
    .from("exam-papers")
    .upload(newPath, webpBuffer, { contentType: "image/webp", upsert: true });
  if (uploadError) {
    return { ok: false, id: row.id, error: `업로드 실패: ${uploadError.message}` };
  }

  const { error: updateError } = await admin
    .from("question_images")
    .update({ image_path: newPath })
    .eq("id", row.id);
  if (updateError) {
    // DB 갱신이 실패하면 새로 올린 webp는 고아 오브젝트가 되니 정리하고, 기존
    // PNG는 그대로 남겨서(image_path가 여전히 .png를 가리키니) 서비스에 지장이 없게 한다.
    await admin.storage.from("exam-papers").remove([newPath]);
    return { ok: false, id: row.id, error: `DB 갱신 실패: ${updateError.message}` };
  }

  // 기존 PNG 삭제는 실패해도 DB가 이미 새 경로를 가리키므로 서비스엔 지장 없다.
  await admin.storage.from("exam-papers").remove([oldPath]);

  return {
    ok: true,
    id: row.id,
    pngSize: pngBuffer.byteLength,
    webpSize: webpBuffer.byteLength,
  };
}
