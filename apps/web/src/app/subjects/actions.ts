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

    // 홈("/")은 갱신하지 않는다 — 홈은 즐겨찾기를 읽지 않는데, 홈 경로를 revalidate 하면
    // 홈이 쓰는 'use cache' 엔트리(문제지 전체 스캔 파생값)까지 만료시켜 다음 방문자가
    // 그 스캔을 기다리게 했다. 목록(/papers)은 요청마다 즐겨찾기를 새로 읽는다.
    revalidatePath("/mypage");
    return { success: true, bookmarked: false };
  }

  const { error } = await supabase
    .from("subject_bookmarks")
    .insert({ user_id: user.id, subject_id: subjectId });
  if (error) return { error: "즐겨찾기에 실패했어요." };

  revalidatePath("/mypage");
  return { success: true, bookmarked: true };
}
