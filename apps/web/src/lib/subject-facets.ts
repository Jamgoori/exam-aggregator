import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { fetchAllPages } from "@/lib/fetch-paged";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 과목 페이지의 급수 탭·직렬 탭에 넣을 값 목록.
//
// 화면이 실제로 쓰는 건 그 과목에 존재하는 급수 5종·직렬 14종 남짓이다. 예전에는
// 그걸 알아내려고 그 과목의 exam_papers 를 두 번 통째로 받아(각각 level 만, exam_type
// 임베드만) 여기서 distinct 를 떴다. 문제가 둘이었다:
//
//   1) range() 가 없어 1000행에서 조용히 잘렸다. 국어·영어·한국사처럼 거의 모든
//      시행처×연도에 있는 과목이 1000장을 넘기면, 뒤쪽 문제지에만 있는 급수·직렬이
//      탭에서 통째로 사라진다. 같은 파일의 목록 조회는 이 한도를 알고 1000씩
//      이어받는데(fetchAllSubjectPapers) 이 두 조회만 빠져 있었다.
//   2) 종류 19개를 알려고 문제지 수백 행을 두 번 실어 날랐다.
//
// distinct 는 DB 가 한다(subject_paper_facets). 돌려주는 행이 종류 수만큼뿐이라
// 자를 일 자체가 없다. 함수가 아직 배포되지 않은 환경에서는 예전처럼 행을 받되,
// 한 번의 조회로 합치고 이번엔 끝까지 페이징한다.
export type SubjectFacets = { levels: string[]; examTypeIds: string[] };

type FacetRow = { level: string | null; exam_type_id: string };

function collect(rows: FacetRow[]): SubjectFacets {
  const levels = new Set<string>();
  const examTypeIds = new Set<string>();
  for (const row of rows) {
    if (row.level) levels.add(row.level);
    if (row.exam_type_id) examTypeIds.add(row.exam_type_id);
  }
  return { levels: [...levels], examTypeIds: [...examTypeIds] };
}

export async function fetchSubjectFacets(
  supabase: Supabase,
  subjectId: string,
): Promise<SubjectFacets> {
  try {
    const { data, error } = await supabase.rpc("subject_paper_facets", {
      p_subject_id: subjectId,
    });
    if (!error) return collect((data ?? []) as FacetRow[]);
  } catch {
    // 함수가 아직 없는 환경(마이그레이션 전). 아래로 떨어진다.
  }

  const rows = await fetchAllPages<FacetRow>(
    (from, to) =>
      supabase
        .from("exam_papers")
        .select("level, exam_type_id")
        .eq("subject_id", subjectId)
        .range(from, to) as unknown as Promise<{
        data: FacetRow[] | null;
        error: { message: string } | null;
      }>,
    "과목 탭 값",
  );
  return collect(rows);
}
