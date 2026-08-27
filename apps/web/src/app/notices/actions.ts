"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { validateNoticeInput } from "@gongmoa/core";

export type NoticeResult = { error?: string; success?: boolean; id?: string };

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
