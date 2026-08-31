"use server";

import { redirect } from "next/navigation";
import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { currentCycleStartDate, DIAGNOSIS_CYCLE_DAYS } from "@/lib/ai-diagnosis";
import { optimizePdf } from "@/lib/optimize-pdf";
import { checkChatClearConfirmation } from "@gongmoa/core";

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

// 테이블 쓰기는 RLS(is_admin)가 최종 방어선이지만, 업로드 액션은 DB insert 전에
// Storage 업로드부터 실행하므로 관리자가 아니면 여기서 먼저 끊는다 (일반 계정이
// 버킷에 파일만 쌓고 가는 것을 방지하는 심층 방어).
async function requireAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<
  | { user: NonNullable<Awaited<ReturnType<typeof supabase.auth.getUser>>["data"]["user"]> }
  | { error: string }
> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return { error: "관리자만 사용할 수 있어요." };
  return { user };
}

export type UploadState = { error?: string; success?: boolean };

export async function uploadExamPaper(
  _prevState: UploadState | undefined,
  formData: FormData,
): Promise<UploadState> {
  const supabase = await createClient();

  const auth = await requireAdmin(supabase);
  if ("error" in auth) {
    return { error: auth.error };
  }
  const { user } = auth;

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

  // object stream으로 구조만 정리하는 무손실 최적화 — 실패해도 원본 그대로
  // 업로드되니 여기서 막힐 일은 없다.
  const optimizedBuffer = await optimizePdf(Buffer.from(await file.arrayBuffer()));

  const { error: uploadError } = await supabase.storage
    .from("exam-papers")
    .upload(filePath, optimizedBuffer, {
      contentType: file.type || "application/pdf",
    });

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
    file_size: optimizedBuffer.byteLength,
    uploaded_by: user.id,
  });

  if (insertError) {
    await supabase.storage.from("exam-papers").remove([filePath]);
    return { error: `저장 실패: ${insertError.message}` };
  }

  revalidatePath("/", "layout");
  // 홈의 전역 데이터 캐시(문제지 목록 등)를 갱신해 새 업로드가 반영되게 한다.
  // "max" = stale-while-revalidate (예전 값을 즉시 주고 뒤에서 새로 받아 교체).
  revalidateTag("home-data", "max");
  return { success: true };
}

export type ReportActionState = { error?: string; success?: boolean };

// 관리 화면(/admin/reports)의 "해결" 토글. 쓰기는 RLS(admin update question_reports)가
// 최종 방어선이지만, 업로드 액션들과 같은 이유로 여기서도 먼저 관리자인지 확인해
// 일반 계정에는 폼 제출 자체를 시도할 이유를 주지 않는다.
export async function setQuestionReportStatus(
  reportId: string,
  status: "open" | "resolved",
): Promise<ReportActionState> {
  const supabase = await createClient();

  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  if (status !== "open" && status !== "resolved") {
    return { error: "잘못된 접근입니다." };
  }

  const { error } = await supabase
    .from("question_reports")
    .update({ status })
    .eq("id", reportId);

  if (error) return { error: "처리에 실패했어요." };

  revalidatePath("/admin/reports");
  return { success: true };
}

export type SaveAnswersState = { error?: string; success?: boolean };

export async function savePaperAnswers(
  _prevState: SaveAnswersState | undefined,
  formData: FormData,
): Promise<SaveAnswersState> {
  const supabase = await createClient();

  const auth = await requireAdmin(supabase);
  if ("error" in auth) {
    return { error: auth.error };
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

  // question_count도 정답 배열 길이로 같이 맞춰준다. 업로드 시 문항 수를 비워뒀거나
  // 잘못 적어둔 경우에도, 정답이 저장되는 순간부터는 이 값이 진짜 문항 수가 된다
  // (CBT 화면이 문항 수를 이 필드 기준으로 판단하기 때문에 비어 있으면 CBT가 열리지 않는다).
  const { error: paperFieldsError } = await supabase
    .from("exam_papers")
    .update({ choice_count: choiceCount, question_count: answers.length })
    .eq("id", paperId);

  if (paperFieldsError) {
    return { error: `저장 실패: ${paperFieldsError.message}` };
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
  // 정답이 새로 생기면 홈의 "바로 풀기"(CBT 가능) 목록이 바뀌므로 홈 캐시도 갱신.
  revalidateTag("home-data", "max");
  return { success: true };
}

// ── AI 약점 진단 초기화(관리자) ───────────────────────────────────────────────
//
// 진단은 주 1회라 한 번 받으면 7일을 기다려야 한다. 검수하려면 같은 계정으로 여러 번
// 돌려봐야 하고, 생성이 실패했다는 문의가 오면 그 주를 되돌려 줘야 한다. 그래서 진단
// 행을 지우는 일을 관리자 화면에 둔다 — 이 테이블은 정책이 없어 service_role 로만
// 쓸 수 있으므로(schema.sql), 이 액션이 유일한 통로다.
//
// **삭제 대상은 진단 요청 기록뿐이다.** 오답·응시 기록은 건드리지 않는다(그쪽이 지워지면
// 사용자의 학습 이력이 사라진다). ai_diagnosis_batches 는 diagnosis_id 외래키의
// on delete cascade 로 같이 정리된다.
export type ResetDiagnosisState = { error?: string; message?: string };

export async function resetDiagnosisCycle(
  _prevState: ResetDiagnosisState | undefined,
  formData: FormData,
): Promise<ResetDiagnosisState> {
  const supabase = await createClient();
  const guard = await requireAdmin(supabase);
  if ("error" in guard) return { error: guard.error };

  // 이메일이 비어 있으면 관리자 본인 계정. 검수용으로 가장 자주 쓰는 경로다.
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const scope = String(formData.get("scope") ?? "cycle") === "all" ? "all" : "cycle";

  const admin = createAdminClient();
  let userId = guard.user.id;
  let label = guard.user.email ?? "내 계정";
  if (email && email !== (guard.user.email ?? "").toLowerCase()) {
    const found = await findUserIdByEmail(admin, email);
    if (!found) return { error: `${email} 계정을 찾지 못했어요.` };
    userId = found;
    label = email;
  }

  // 지우기 전에 무엇을 지우는지 센다. 진행 중인 배치가 있으면 그 사실을 결과에 밝힌다 —
  // 그 배치의 결과는 수거할 행이 사라져 버려지고(요금은 이미 나갔다), 사용자가 곧바로
  // 다시 요청하면 같은 분석에 두 번 요금이 나간다.
  let query = admin.from("ai_diagnoses").select("id").eq("user_id", userId);
  if (scope === "cycle") query = query.gte("diagnosis_date", currentCycleStartDate());
  const { data: rows, error: readError } = await query;
  if (readError) return { error: "진단 기록을 읽지 못했어요." };
  const ids = (rows ?? []).map((r) => r.id as string);
  if (ids.length === 0) {
    return {
      message:
        scope === "cycle"
          ? `${label}: 이번 주기(${DIAGNOSIS_CYCLE_DAYS}일)에 받은 진단이 없어요. 이미 다시 받을 수 있는 상태예요.`
          : `${label}: 지울 진단 기록이 없어요.`,
    };
  }

  const { count: pendingBatches } = await admin
    .from("ai_diagnosis_batches")
    .select("id", { count: "exact", head: true })
    .in("diagnosis_id", ids)
    .eq("status", "pending");

  const { error: deleteError } = await admin.from("ai_diagnoses").delete().in("id", ids);
  if (deleteError) return { error: "초기화에 실패했어요." };

  revalidatePath("/mypage/diagnosis");
  revalidatePath("/mypage");
  const warn =
    (pendingBatches ?? 0) > 0
      ? " 만들던 중인 배치가 있어 그 결과는 버려져요(요금은 이미 나갔습니다). 바로 다시 요청하면 같은 분석에 두 번 요금이 나갑니다."
      : "";
  return {
    message: `${label}: 진단 기록 ${ids.length}건을 지웠어요. 이제 바로 다시 받을 수 있어요.${warn}`,
  };
}

// 이메일로 사용자를 찾는다. auth.users 는 PostgREST 로 못 읽어서 Admin API 를 훑는다.
// 관리자만 닿는 경로이고 계정 수가 수천 단위라 페이지 몇 장이면 끝난다 — 사용자 수가
// 크게 늘면 이메일을 담은 별도 테이블을 두는 편이 낫다.
async function findUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return null;
    const users = data?.users ?? [];
    const hit = users.find((u) => (u.email ?? "").toLowerCase() === email);
    if (hit) return hit.id;
    if (users.length < 1000) return null;
  }
  return null;
}

// ── 채팅 기록 초기화(관리자) ──────────────────────────────────────────────────
//
// 채팅방은 공개된 공간이라 비방·개인정보·도배가 남으면 지울 수단이 있어야 한다.
// chat_messages 는 anon/authenticated 의 쓰기 권한이 없어(schema.sql) service_role
// 로만 지울 수 있으므로, 이 액션이 유일한 통로다.
//
// 범위는 둘 중 하나다: 방 전체 비우기, 또는 한 계정이 남긴 메시지만 지우기(특정
// 사용자의 도배를 치울 때). 전체 비우기는 되돌릴 수 없어서 확인 문구를 요구한다.
export type ClearChatState = { error?: string; message?: string };

export async function clearChatHistory(
  _prevState: ClearChatState | undefined,
  formData: FormData,
): Promise<ClearChatState> {
  const supabase = await createClient();
  const guard = await requireAdmin(supabase);
  if ("error" in guard) return { error: guard.error };

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const admin = createAdminClient();

  // 이메일이 있으면 그 계정 메시지만, 비어 있으면 방 전체. 전체일 때만 확인 문구를
  // 받는다 — 한 사람 것을 지우는 일은 되돌릴 수 없어도 파장이 그 사람에 그친다.
  let userId: string | null = null;
  let label: string;
  if (email) {
    userId = await findUserIdByEmail(admin, email);
    if (!userId) return { error: `${email} 계정을 찾지 못했어요.` };
    label = email;
  } else {
    const confirmCheck = checkChatClearConfirmation(String(formData.get("confirm") ?? ""));
    if (!confirmCheck.ok) return { error: confirmCheck.error };
    label = "채팅방 전체";
  }

  // 지우기 전에 몇 건인지 센다(결과 문구에 그대로 쓴다). 0건이면 삭제를 건너뛴다.
  let countQuery = admin.from("chat_messages").select("id", { count: "exact", head: true });
  if (userId) countQuery = countQuery.eq("user_id", userId);
  const { count, error: countError } = await countQuery;
  if (countError) return { error: "채팅 기록을 읽지 못했어요." };
  if (!count) return { message: `${label}: 지울 메시지가 없어요.` };

  // PostgREST 는 필터 없는 delete 를 거부한다 — 전체 삭제도 "항상 참"인 조건을 붙인다.
  const deleteQuery = admin.from("chat_messages").delete();
  const { error: deleteError } = userId
    ? await deleteQuery.eq("user_id", userId)
    : await deleteQuery.not("id", "is", null);
  if (deleteError) return { error: "초기화에 실패했어요." };

  return { message: `${label}: 메시지 ${count}건을 지웠어요.` };
}
