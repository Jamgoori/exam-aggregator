"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase/session";

// UUID 형식 검증 (임의 문자열이 쿼리에 들어가지 않도록 1차 방어)
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export type SubjectBookmarkResult = {
  error?: string;
  success?: boolean;
  bookmarked?: boolean;
};

export async function toggleSubjectBookmark(
  subjectId: string,
): Promise<SubjectBookmarkResult> {
  if (!isUuid(subjectId)) return { error: "잘못된 접근입니다." };

  const { supabase, user } = await getSessionUser();
  if (!user) return { error: "로그인이 필요해요." };

  const { data: existing } = await supabase
    .from("subject_bookmarks")
    .select("id")
    .eq("user_id", user.id)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from("subject_bookmarks")
      .delete()
      .eq("id", existing.id);
    if (error) return { error: "즐겨찾기 해제에 실패했어요." };

    revalidatePath("/bookmarks");
    return { success: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("subject_bookmarks")
    .insert({ user_id: user.id, subject_id: subjectId });
  if (error) return { error: "즐겨찾기에 실패했어요." };

  revalidatePath("/bookmarks");
  return { success: true, bookmarked: true };
}
