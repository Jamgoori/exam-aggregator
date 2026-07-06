import "server-only";
import type { createClient } from "@/lib/supabase/server";

// 문제지 목록(홈/과목별/즐겨찾기/같은 과목 목록)에 "N회독" 배지를 달아주기 위해,
// 로그인한 사용자가 그 목록에 있는 문제지들을 각각 몇 번 응시했는지 한 번에 센다.
export async function getMyRoundCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  paperIds: string[],
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (paperIds.length === 0) return counts;

  const { data } = await supabase
    .from("cbt_attempts")
    .select("paper_id")
    .eq("user_id", userId)
    .in("paper_id", paperIds);

  for (const row of data ?? []) {
    const id = row.paper_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
