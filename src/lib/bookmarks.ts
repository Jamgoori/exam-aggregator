import "server-only";
import type { createClient } from "@/lib/supabase/server";

// 문제지 목록 카드에 북마크 상태를 표시하기 위해, 화면에 보이는 문제지들 중
// 로그인한 사용자가 즐겨찾기한 것만 배치로 확인한다.
export async function getMyBookmarkedPaperIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  paperIds: string[],
): Promise<Set<string>> {
  if (paperIds.length === 0) return new Set();

  const { data } = await supabase
    .from("bookmarks")
    .select("paper_id")
    .eq("user_id", userId)
    .in("paper_id", paperIds);

  return new Set((data ?? []).map((row) => row.paper_id as string));
}
