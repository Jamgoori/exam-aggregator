import "server-only";
import type { createClient } from "@/lib/supabase/server";

// 과목 상세페이지·과목 인덱스 모달에서 별 아이콘 초기 상태를 표시하기 위해,
// 화면에 보이는 과목들 중 로그인한 사용자가 즐겨찾기한 것만 배치로 확인한다.
export async function getMyBookmarkedSubjectIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Set<string>> {
  const { data } = await supabase
    .from("subject_bookmarks")
    .select("subject_id")
    .eq("user_id", userId);

  return new Set((data ?? []).map((row) => row.subject_id as string));
}
