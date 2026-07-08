import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { LightPaper } from "@/lib/paper-search";

// Supabase(PostgREST)는 range()를 안 주면 기본적으로 한 번에 최대 1000행까지만
// 돌려준다(db.max_rows 설정). 홈 검색을 위해 문제지 "전체"를 한 번에 받아야 하는데
// 이 기본 한도에 걸리면 1000건 뒤는 조용히 잘려서 "총 1000개의 자료"처럼 실제
// 개수보다 작게 보였다. 1000건씩 끝까지 이어받아 진짜 전체 목록을 만든다.
const BATCH_SIZE = 1000;

export async function fetchAllExamPapers(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<LightPaper[]> {
  const rows: LightPaper[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("exam_papers")
      .select("id, title, level, year, round, subject_id, subjects(id, name, slug)")
      .order("year", { ascending: false })
      .order("round", { ascending: false })
      // year/round만으로는 동점(같은 연도·회차의 여러 과목)이 흔해서, range로
      // 나눠 받을 때 정렬이 흔들리지 않도록 id를 마지막 기준으로 고정한다.
      .order("id", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);

    if (error || !data || data.length === 0) break;
    rows.push(...(data as unknown as LightPaper[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  return rows;
}
