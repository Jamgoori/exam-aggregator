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

export type SaveAnswersState = { error?: string; success?: boolean };

export async function savePaperAnswers(
  _prevState: SaveAnswersState | undefined,
  formData: FormData,
): Promise<SaveAnswersState> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "로그인이 필요합니다." };
  }

  const paperId = String(formData.get("paper_id") ?? "");
  const answersRaw = String(formData.get("answers") ?? "").trim();

  if (!paperId || !answersRaw) {
    return { error: "정답을 입력해주세요." };
  }

  const answers = answersRaw
    .split(/[,\s]+/)
    .filter(Boolean)
    .map((s) => Number(s));

  // 실제 정답지에 몇 번까지 나오는지로 선지 수를 그대로 추론한다 (5번 정답이 하나라도
  // 있으면 5지선다). 관리자가 선지 수를 따로 고를 필요가 없게 하려는 의도.
  const MAX_CHOICE_COUNT = 5;
  if (
    answers.length === 0 ||
    answers.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_CHOICE_COUNT)
  ) {
    return {
      error: `정답은 1~${MAX_CHOICE_COUNT} 사이 숫자로, 쉼표나 공백으로 구분해 입력해주세요.`,
    };
  }
  const choiceCount = Math.max(4, ...answers);

  const { error: choiceCountError } = await supabase
    .from("exam_papers")
    .update({ choice_count: choiceCount })
    .eq("id", paperId);

  if (choiceCountError) {
    return { error: `저장 실패: ${choiceCountError.message}` };
  }

  const { error } = await supabase.from("paper_answers").upsert(
    { paper_id: paperId, answers, updated_at: new Date().toISOString() },
    { onConflict: "paper_id" },
  );

  if (error) {
    return { error: `저장 실패: ${error.message}` };
  }

  revalidatePath(`/admin/answers/${paperId}`);
  revalidatePath("/admin/answers");
  return { success: true };
}
