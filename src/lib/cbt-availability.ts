import "server-only";
import type { createClient } from "@/lib/supabase/server";

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
  const { data } = await supabase.rpc("has_cbt_answers_all");

  return new Set(
    ((data ?? []) as { paper_id: string }[]).map((row) => row.paper_id),
  );
}
