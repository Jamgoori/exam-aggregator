import "server-only";
import type { createClient } from "@/lib/supabase/server";
import type { LightPaper } from "@/lib/paper-search";

// Supabase(PostgREST)는 range()를 안 주면 기본적으로 한 번에 최대 1000행까지만
// 돌려준다(db.max_rows 설정). 홈 검색을 위해 문제지 "전체"를 한 번에 받아야 하는데
// 이 기본 한도에 걸리면 1000건 뒤는 조용히 잘려서 "총 1000개의 자료"처럼 실제
// 개수보다 작게 보였다. 1000건씩 끝까지 이어받아 진짜 전체 목록을 만든다.
const BATCH_SIZE = 1000;

// 각 직렬(시험 종류)의 관례적 필기 시행 월(대략). round는 직렬마다 독립적으로
// 매겨져서(국가직 round=1, 지방직 round=1) 서로 다른 직렬 사이의 실제 시행 순서를
// 담지 못한다. 그래서 같은 연도 안에서 "최근에 치른 시험"이 먼저 보이도록, 직렬별
// 관례 월을 타이브레이커로 쓴다. 실제 그 해 정확한 시행일이 아니라 근사치이며
// (경찰·해경은 연 2회 이상이라 대략적 위치, 간호직은 지방직에 묶여 6월경),
// 여기 없는 직렬은 0으로 취급해 그 해 맨 뒤로 보낸다.
const TYPICAL_EXAM_MONTH: Record<string, number> = {
  소방: 3,
  계리직: 3,
  국가직: 4,
  기상직: 4,
  지방직: 6,
  서울시: 6,
  법원직: 6,
  간호직: 6,
  지역인재: 7,
  경찰: 8,
  해경: 8,
  국회직: 9,
};

export async function fetchAllExamPapers(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<LightPaper[]> {
  // 직렬별 관례 월 조회용: exam_type_id -> 월. 12행 남짓이라 한 번에 받는다.
  const { data: examTypes } = await supabase
    .from("exam_types")
    .select("id, name");
  const monthByExamTypeId = new Map(
    (examTypes ?? []).map((t) => [t.id, TYPICAL_EXAM_MONTH[t.name] ?? 0]),
  );

  const rows: LightPaper[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("exam_papers")
      .select(
        "id, title, level, year, round, subject_id, exam_type_id, subjects(id, name, slug), exam_types(id, name)",
      )
      .order("year", { ascending: false })
      .order("round", { ascending: false })
      // year/round만으로는 동점(같은 연도·회차의 여러 과목)이 흔해서, range로
      // 나눠 받을 때 페이지 경계에서 정렬이 흔들리지 않도록 id를 마지막 기준으로
      // 고정한다. (최종 표시 순서는 아래에서 관례 월까지 반영해 다시 정렬한다.)
      .order("id", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);

    if (error || !data || data.length === 0) break;
    rows.push(...(data as unknown as LightPaper[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }

  // 같은 연도 안에서는 관례상 늦게(=최근에) 치르는 직렬이 먼저 오도록 정렬한다.
  // 예) 2026년이면 6월 지방직이 4월 국가직보다 앞. 월이 같으면 회차 늦은 것,
  // 그래도 같으면 id로 안정적으로 정렬한다. (Array.prototype.sort는 안정 정렬)
  rows.sort((a, b) => {
    if (a.year !== b.year) return b.year - a.year;
    const am = monthByExamTypeId.get(a.exam_type_id) ?? 0;
    const bm = monthByExamTypeId.get(b.exam_type_id) ?? 0;
    if (am !== bm) return bm - am;
    if (a.round !== b.round) return b.round - a.round;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return rows;
}
