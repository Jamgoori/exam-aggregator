"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { validateNoticeCommentContent, validateNoticeInput } from "@gongmoa/core";
import {
  createNoticeComment as createNoticeCommentRule,
  deleteNoticeComment as deleteNoticeCommentRule,
  updateNoticeComment as updateNoticeCommentRule,
  type NoticeActor,
} from "@gongmoa/core/server";

export type NoticeResult = { error?: string; success?: boolean; id?: string };

// 댓글의 시간당 상한(30건)은 core rules/hourly-limit.ts 의 NOTICE_COMMENT_HOURLY_LIMIT 다 —
// Edge notices-write 와 같은 값이어야 해서 여기 적지 않는다. 원글(관리자 전용 작성)은
// 관리자만 쓰는 데다 자기 사이트 공지라 도배 걱정이 없어 별도 상한이 없다.

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 목록·상세 어느 쪽에서 글을 고쳐도 두 화면이 같이 최신이 되게 한다.
function revalidateNotice(id?: string) {
  revalidatePath("/notices");
  if (id) revalidatePath(`/notices/${id}`);
}

// 쓰기는 RLS(is_admin)가 최종 방어선이지만, 여기서 먼저 끊어야 관리자가 아닌
// 계정에게는 "권한이 없어요"라는 명확한 메시지를 돌려줄 수 있다(admin/actions.ts
// requireAdmin과 같은 이유).
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "로그인이 필요합니다." };

  const { data: isAdmin } = await supabase.rpc("is_admin");
  if (isAdmin !== true) return { error: "관리자만 사용할 수 있어요." };
  return { user };
}

export async function createNotice(input: {
  title: string;
  content: string;
  isPinned?: boolean;
}): Promise<NoticeResult> {
  const validated = validateNoticeInput(input);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { data, error } = await supabase
    .from("notices")
    .insert({
      title: validated.title,
      content: validated.content,
      is_pinned: input.isPinned === true,
      created_by: auth.user.id,
    })
    .select("id")
    .single();

  if (error || !data) return { error: "등록에 실패했어요." };

  revalidateNotice(data.id as string);
  return { success: true, id: data.id as string };
}

export async function updateNotice(input: {
  id: string;
  title: string;
  content: string;
  isPinned?: boolean;
}): Promise<NoticeResult> {
  const id = String(input.id ?? "");
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const validated = validateNoticeInput(input);
  if ("error" in validated) return { error: validated.error };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { error } = await supabase
    .from("notices")
    .update({
      title: validated.title,
      content: validated.content,
      is_pinned: input.isPinned === true,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: "수정에 실패했어요." };

  revalidateNotice(id);
  return { success: true, id };
}

export async function deleteNotice(id: string): Promise<NoticeResult> {
  if (!isUuid(id)) return { error: "잘못된 접근입니다." };

  const supabase = await createClient();
  const auth = await requireAdmin(supabase);
  if ("error" in auth) return { error: auth.error };

  const { error } = await supabase.from("notices").delete().eq("id", id);
  if (error) return { error: "삭제에 실패했어요." };

  revalidateNotice(id);
  return { success: true };
}

// ── 댓글 ─────────────────────────────────────────────────────────────────────
// 원글(제목·내용)은 관리자만 쓸 수 있지만, 댓글은 반대로 로그인 회원이면 누구나
// 달 수 있다. 규칙(도배 방지 30건/h·비속어·닉네임 확정·본인/관리자 권한)은
// packages/core/src/rules/notices.ts 에 있고 Edge Function notices-write 가 같은 함수를
// 부른다 — 여기는 세션 확보와 revalidate 만 하는 어댑터다.
//
// 규칙은 admin 클라이언트로 부른다(Edge 와 같은 경로). 예전처럼 세션 클라이언트 + RLS 에
// 기대지 않는 대신 규칙 본문이 소유자 조건을 명시한다(rules/notices.ts 머리말).

async function getNoticeActor(): Promise<NoticeActor | null> {
  const { supabase, user } = await getSessionUser();
  if (!user) return null;
  const { data: isAdminData } = await supabase.rpc("is_admin");
  return {
    userId: user.id,
    isAdmin: isAdminData === true,
    // 이메일 로컬파트로 떨어지지 않는다 — 그 값은 닉네임 정책(금칙어·중복)을 지나간
    // 적이 없어서 "관리자" 같은 이름이 그대로 박힌다(core의 authorNickname 주석 참고).
    metadataNickname: user.user_metadata?.nickname,
  };
}

export async function createNoticeComment(input: {
  noticeId: string;
  content: string;
}): Promise<NoticeResult> {
  // 입력 모양·내용 검증은 규칙도 하지만, 로그인 전에 끊던 웹의 순서를 그대로 둔다(문구 동일).
  if (!isUuid(String(input.noticeId ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const actor = await getNoticeActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await createNoticeCommentRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateNotice(result.id);
  return { success: true, id: result.id };
}

export async function updateNoticeComment(input: {
  commentId: string;
  content: string;
}): Promise<NoticeResult> {
  if (!isUuid(String(input.commentId ?? ""))) return { error: "잘못된 접근입니다." };
  const validated = validateNoticeCommentContent(input.content);
  if ("error" in validated) return { error: validated.error };

  const actor = await getNoticeActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await updateNoticeCommentRule(createAdminClient(), { actor, ...input });
  if ("error" in result) return { error: result.error };

  revalidateNotice(result.id);
  return { success: true, id: result.id };
}

export async function deleteNoticeComment(commentId: string): Promise<NoticeResult> {
  if (!isUuid(commentId)) return { error: "잘못된 접근입니다." };

  const actor = await getNoticeActor();
  if (!actor) return { error: "로그인 후 이용할 수 있어요." };

  const result = await deleteNoticeCommentRule(createAdminClient(), { actor, commentId });
  if ("error" in result) return { error: result.error };

  revalidateNotice(result.id);
  return { success: true };
}
