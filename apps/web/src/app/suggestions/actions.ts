"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { getSuggestionViewer } from "@/lib/suggestions";
import {
  canDeleteSuggestion,
  canEditSuggestion,
  NICKNAME_MAX,
  validateSuggestionAnswer,
  validateSuggestionInput,
} from "@gongmoa/core";

export type SuggestionResult = { error?: string; success?: boolean; id?: string };

// 한 계정이 짧은 시간에 게시판을 도배하는 것만 막는 느슨한 상한. 정상적인 건의는
// 하루에 몇 건을 넘지 않는다 (문항 오류 신고와 같은 기준).
const HOURLY_LIMIT = 10;

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 목록·상세 어느 쪽에서 글을 고쳐도 두 화면이 같이 최신이 되게 한다.
function revalidateSuggestion(id?: string) {
  revalidatePath("/suggestions");
  if (id) revalidatePath(`/suggestions/${id}`);
}

export async function createSuggestion(input: {
  title: string;
  content: string;
  isSecret: boolean;
}): Promise<SuggestionResult> {
  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();

  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await admin
    .from("suggestions")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("created_at", oneHourAgo);
  if ((count ?? 0) >= HOURLY_LIMIT) {
    return { error: "짧은 시간 동안 너무 많이 작성했어요. 잠시 후 다시 시도해주세요." };
  }

  // 작성자명은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의
  // 이름으로 글을 쓸 수 있다. 화면에 보이는 닉네임의 원본은
  // auth.users.raw_user_meta_data.nickname 이고(schema.sql 참고) profiles 는
  // 중복 판별용 그림자 원장이라, 댓글과 같은 순서로 읽는다.
  const nickname =
    (user.user_metadata?.nickname as string | undefined) ??
    user.email?.split("@")[0] ??
    "회원";

  const { data, error } = await admin
    .from("suggestions")
    .insert({
      user_id: user.id,
      nickname: nickname.slice(0, NICKNAME_MAX),
      title: validated.title,
      content: validated.content,
      is_secret: input.isSecret === true,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요." };

  revalidateSuggestion(data.id as string);
  return { success: true, id: data.id as string };
}

export async function updateSuggestion(input: {
  id: string;
  title: string;
  content: string;
  isSecret: boolean;
}): Promise<SuggestionResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canEditSuggestion({ user_id: post.user_id as string, is_secret: post.is_secret as boolean }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin
    .from("suggestions")
    .update({
      title: validated.title,
      content: validated.content,
      is_secret: input.isSecret === true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "수정에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true, id };
}

export async function deleteSuggestion(id: string): Promise<SuggestionResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const viewer = await getSuggestionViewer();
  if (!viewer.loggedIn) return { error: "로그인 후 이용할 수 있어요." };

  const admin = createAdminClient();
  const { data: post } = await admin
    .from("suggestions")
    .select("user_id, is_secret")
    .eq("id", id)
    .maybeSingle();
  if (!post) return { error: "글을 찾을 수 없어요." };

  if (!canDeleteSuggestion({ user_id: post.user_id as string, is_secret: post.is_secret as boolean }, viewer)) {
    return { error: "권한이 없어요." };
  }

  const { error } = await admin.from("suggestions").delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true };
}

// 관리자 답변 등록/수정. 답변은 본문과 별도 컬럼이라 원글은 그대로 남는다.
export async function answerSuggestion(input: {
  id: string;
  answer: string;
}): Promise<SuggestionResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateSuggestionAnswer(input.answer);
  if ("error" in validated) return { error: validated.error };

  const viewer = await getSuggestionViewer();
  if (!viewer.isAdmin) return { error: "권한이 없어요." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("suggestions")
    .update({
      answer: validated.answer,
      answered_at: new Date().toISOString(),
      answered_by: viewer.userId,
    })
    .eq("id", id);
  if (error) return { error: "답변 등록에 실패했어요." };

  revalidateSuggestion(id);
  return { success: true, id };
}
