import "server-only";
import type { createClient } from "@/lib/supabase/server";

// PostgREST는 range()를 안 주면 한 번에 최대 1000행만 돌려준다(db.max_rows).
// paper_answers가 1000건을 넘어서면서 has_cbt_answers_all()도 이 한도에 걸려,
// 1000번째 뒤의 문제지는 정답이 멀쩡히 있는데도 "바로 풀기" 버튼이 안 떴다.
// 1000건씩 끝까지 이어받아 진짜 전체 목록을 만든다.
const BATCH_SIZE = 1000;

// 문제지 목록 카드에서 "바로 풀기" 버튼을 보여줄지 판단하기 위해, 화면에 보이는
// 문제지들만 골라 CBT 정답이 등록돼 있는지 한 번에 확인한다. paper_answers는 정답이
// 들어있어 일반 select가 막혀 있으므로(관리자 전용 RLS), security definer 함수로
// 존재 여부만 배치로 받아온다.
export async function getCbtAvailability(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paperIds: string[],
): Promise<Set<string>> {
  if (paperIds.length === 0) return new Set();

  const { data } = await supabase.rpc("has_cbt_answers_bulk", {
    target_paper_ids: paperIds,
  });

  return new Set(
    ((data ?? []) as { paper_id: string }[]).map((row) => row.paper_id),
  );
}

// 홈 화면 검색이 클라이언트에서 전체 문제지 목록을 즉시 필터링하는 방식이라, 미리
// "어떤 문제지가 보일지"를 서버가 알 수 없다. 그래서 이 값은 문제지 범위를 좁히지
// 않고 전부 한 번에 받아, 클라이언트가 필터링한 결과 위에 그대로 얹어 쓴다.
export async function getAllCbtAvailability(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .rpc("has_cbt_answers_all")
      .range(from, from + BATCH_SIZE - 1);

    if (error || !data || data.length === 0) break;
    for (const row of data as { paper_id: string }[]) ids.add(row.paper_id);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return ids;
}
