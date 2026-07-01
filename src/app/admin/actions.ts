"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function login(formData: FormData) {
  const email = String(formData.get("email") ?? "");
  const password = String(formData.get("password") ?? "");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/admin/login?error=1");
  }

  redirect("/admin/upload");
}

export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}

export type UploadState = { error?: string; success?: boolean };

export async function uploadExamPaper(
  _prevState: UploadState | undefined,
  formData: FormData,
): Promise<UploadState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const file = formData.get("file") as File | null;
  const subjectId = String(formData.get("subject_id") ?? "");
  const examTypeId = String(formData.get("exam_type_id") ?? "");
  const year = Number(formData.get("year"));
  const round = Number(formData.get("round") ?? 1);
  const level = String(formData.get("level") ?? "").trim();
  const title = String(formData.get("title") ?? "");
  const questionCountRaw = String(formData.get("question_count") ?? "").trim();
  const tagsRaw = String(formData.get("tags") ?? "").trim();

  if (!file || file.size === 0) {
    return { error: "파일을 선택해주세요." };
  }
  if (!subjectId || !examTypeId || !year || !title) {
    return { error: "필수 항목을 모두 입력해주세요." };
  }

  const filePath = `${year}/${crypto.randomUUID()}.pdf`;

  const { error: uploadError } = await supabase.storage
    .from("exam-papers")
    .upload(filePath, file, { contentType: file.type || "application/pdf" });

  if (uploadError) {
    return { error: `업로드 실패: ${uploadError.message}` };
  }

  const tags = tagsRaw
    ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const { error: insertError } = await supabase.from("exam_papers").insert({
    subject_id: subjectId,
    exam_type_id: examTypeId,
    year,
    round,
    level: level || null,
    title,
    question_count: questionCountRaw ? Number(questionCountRaw) : null,
    tags,
    file_path: filePath,
    file_name: file.name,
    file_size: file.size,
    uploaded_by: user.id,
  });

  if (insertError) {
    await supabase.storage.from("exam-papers").remove([filePath]);
    return { error: `저장 실패: ${insertError.message}` };
  }

  revalidatePath("/", "layout");
  return { success: true };
}
