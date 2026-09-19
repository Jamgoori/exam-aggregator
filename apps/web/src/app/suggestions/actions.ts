"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import {
  validateSuggestionAnswer,
  validateSuggestionCommentContent,
  validateSuggestionInput,
} from "@gongmoa/core";
import {
  answerSuggestion as answerSuggestionRule,
  createSuggestion as createSuggestionRule,
  createSuggestionComment as createSuggestionCommentRule,
  deleteSuggestion as deleteSuggestionRule,
  deleteSuggestionComment as deleteSuggestionCommentRule,
  updateSuggestion as updateSuggestionRule,
  updateSuggestionComment as updateSuggestionCommentRule,
  type SuggestionActor,
} from "@gongmoa/core/server";

// 건의게시판 서버 액션 — **어댑터**다. 규칙(검증, 고정·비밀 확정, 시간당 한도 10/30, 비밀글 댓글 권한,
// 소유자 조건, 알림)은 전부 packages/core/src/rules/suggestions.ts 에 있고, Edge Function `suggestions`
// 가 같은 함수를 부른다. 여기 남은 것은 세션 확보·revalidate 뿐이다 — 여기에 if 가 늘기 시작하면
// 규칙이 새는 것이다(docs/agents/edge-core-bundle.md). 반환 모양·문구·revalidate 는 예전과 같다.

export type SuggestionResult = { error?: string; success?: boolean; id?: string };

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 목록·상세 어느 쪽에서 글을 고쳐도 두 화면이 같이 최신이 되게 한다.
function revalidateSuggestion(id?: string) {
  revalidatePath("/suggestions");
  if (id) revalidatePath(`/suggestions/${id}`);
}

// 규칙에 넘길 사용자. 닉네임은 세션에서만 가져온다 — 클라이언트가 보내는 이름을 믿으면 남의 이름으로
// 글을 쓸 수 있다. 관리자 여부는 웹이 늘 쓰는 rpc("is_admin")(Edge 는 같은 admins 표를 이메일로 본다).
async function getSuggestionActor(): Promise<SuggestionActor | null> {
  const { supabase, user } = await getSessionUser();
  if (!user) return null;
  const { data: isAdminData } = await supabase.rpc("is_admin");
  return {
    userId: user.id,
    isAdmin: isAdminData === true,
    metadataNickname: user.user_metadata?.nickname,
  };
}

export async function createSuggestion(input: {
  title: string;
  content: string;
  isSecret: boolean;
  isPinned?: boolean;
}): Promise<SuggestionResult> {
  // 검증은 규칙도 하지만, 로그인 전에 끊던 웹의 순서를 그대로 둔다(문구 동일).
  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await createSuggestionRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true, id: result.id };
}

export async function updateSuggestion(input: {
  id: string;
  title: string;
  content: string;
  isSecret: boolean;
  isPinned?: boolean;
}): Promise<SuggestionResult> {
  // id 모양·검증은 규칙도 보지만, 로그인 전에 끊던 웹의 순서를 그대로 둔다(문구 동일).
  if (!isUuid(String(input.id ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateSuggestionInput(input);
  if ("error" in validated) return { error: validated.error };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await updateSuggestionRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true, id: result.id };
}

export async function deleteSuggestion(id: string): Promise<SuggestionResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await deleteSuggestionRule(createAdminClient(), { actor, id });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(id);
  return { success: true };
}

// 관리자 답변 등록/수정. 답변은 본문과 별도 컬럼이라 원글은 그대로 남는다.
export async function answerSuggestion(input: {
  id: string;
  answer: string;
}): Promise<SuggestionResult> {
  if (!isUuid(String(input.id ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateSuggestionAnswer(input.answer);
  if ("error" in validated) return { error: validated.error };

  // 비로그인도 "권한이 없어요." — 예전 웹이 viewer.isAdmin 만 봤던 것과 같은 문구.
  const actor = await getSuggestionActor();
  if (!actor) return { error: "권한이 없어요." };

  const result = await answerSuggestionRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true, id: result.id };
}

export async function createSuggestionComment(input: {
  suggestionId: string;
  content: string;
}): Promise<SuggestionResult> {
  if (!isUuid(String(input.suggestionId ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await createSuggestionCommentRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true, id: result.id };
}

export async function updateSuggestionComment(input: {
  commentId: string;
  content: string;
}): Promise<SuggestionResult> {
  if (!isUuid(String(input.commentId ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateSuggestionCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await updateSuggestionCommentRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true, id: result.id };
}

export async function deleteSuggestionComment(commentId: string): Promise<SuggestionResult> {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const actor = await getSuggestionActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await deleteSuggestionCommentRule(createAdminClient(), { actor, commentId });
  if ("error" in result) return { error: result.error };

  revalidateSuggestion(result.id);
  return { success: true };
}
