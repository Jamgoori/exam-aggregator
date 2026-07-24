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

// 홈 화면 검색이 클라이언트에서 전체 문제지 목록을 즉시 필터링하는 방식이라, 미리
// "어떤 문제지가 보일지"를 서버가 알 수 없다. 그래서 이 사용자의 즐겨찾기 전체를
// (문제지 개수와 무관하게 본인 것만이라 RLS로 이미 작다) 한 번에 받아온다.
export async function getAllMyBookmarkedPaperIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("bookmarks")
    .select("paper_id")
    .eq("user_id", userId);

  return new Set((data ?? []).map((row) => row.paper_id as string));
}
