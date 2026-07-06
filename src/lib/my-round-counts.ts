import "server-only";
import type { createClient } from "@/lib/supabase/server";

// 문제지 목록(홈/과목별/즐겨찾기/같은 과목 목록)에 "N회독" 배지를 달아주기 위해,
// 로그인한 사용자가 문제지별로 몇 번 응시했는지 센다. 사용자의 전체 응시 기록을
// 한 번에 받아 문제지별로 집계하므로(개인 응시 수는 자연히 수백 건 수준), 화면에
// 어떤 문제지 목록이 뜰지 확정되기 전에도 목록 조회와 병렬로 실행할 수 있다.
export async function getMyRoundCounts(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();

  const { data } = await supabase
    .from("cbt_attempts")
    .select("paper_id")
    .eq("user_id", userId);

  for (const row of data ?? []) {
    const id = row.paper_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
