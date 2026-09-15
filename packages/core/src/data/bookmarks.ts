import type { SupabaseClient } from "@supabase/supabase-js";

// 즐겨찾기(문제지·과목) — 웹 lib/bookmarks.ts·lib/subject-bookmarks.ts(조회)와
// app/papers/actions.ts toggleBookmark·app/subjects/actions.ts toggleSubjectBookmark(토글)를
// DI 로 옮긴 것. 전부 RLS(select/insert/delete own) 직접 접근이라 서버 액션이 필요 없다
// (설계서 §6.2 즐겨찾기 행). 오류 문구는 웹 서버 액션과 같다.

// 이 사용자의 즐겨찾기 전체(본인 것만이라 RLS 로 이미 작다). 순서는 북마크한 순(created_at desc,
// 웹 mypage/page.tsx 와 동일) — Set 은 삽입 순서를 지키므로 목록 화면이 그대로 쓴다.
export async function fetchMyBookmarkedPaperIds(
  client: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data } = await client
    .from("bookmarks")
    .select("paper_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return new Set(((data ?? []) as { paper_id: string }[]).map((row) => row.paper_id));
}

export async function fetchMyBookmarkedSubjectIds(
  client: SupabaseClient,
  userId: string,
): Promise<Set<string>> {
  const { data } = await client.from("subject_bookmarks").select("subject_id").eq("user_id", userId);
  return new Set(((data ?? []) as { subject_id: string }[]).map((row) => row.subject_id));
}

// 있으면 지우고 없으면 넣는다. 돌려주는 값은 토글 후 상태.
export async function togglePaperBookmark(
  client: SupabaseClient,
  userId: string,
  paperId: string,
): Promise<{ bookmarked: boolean }> {
  const { data: existing } = await client
    .from("bookmarks")
    .select("id")
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .maybeSingle();

  if (existing) {
    const { error } = await client.from("bookmarks").delete().eq("id", (existing as { id: string }).id);
    if (error) throw new Error("즐겨찾기 해제에 실패했어요.");
    return { bookmarked: false };
  }
  const { error } = await client.from("bookmarks").insert({ user_id: userId, paper_id: paperId });
  if (error) throw new Error("즐겨찾기에 실패했어요.");
  return { bookmarked: true };
}

export async function toggleSubjectBookmark(
  client: SupabaseClient,
  userId: string,
  subjectId: string,
): Promise<{ bookmarked: boolean }> {
  const { data: existing } = await client
    .from("subject_bookmarks")
    .select("id")
    .eq("user_id", userId)
    .eq("subject_id", subjectId)
    .maybeSingle();

  if (existing) {
    const { error } = await client.from("subject_bookmarks").delete().eq("id", (existing as { id: string }).id);
    if (error) throw new Error("즐겨찾기 해제에 실패했어요.");
    return { bookmarked: false };
  }
  const { error } = await client.from("subject_bookmarks").insert({ user_id: userId, subject_id: subjectId });
  if (error) throw new Error("즐겨찾기에 실패했어요.");
  return { bookmarked: true };
}
