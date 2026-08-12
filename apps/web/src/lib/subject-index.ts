import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import type { Subject } from "@gongmoa/core";

export type SubjectIndexEntry = {
  slug: string;
  name: string;
  /** 중복 시험지를 합친 뒤의 자료 수 — 홈·과목 페이지에 보이는 개수와 같다. */
  count: number;
  minYear: number;
  maxYear: number;
};

// 과목 인덱스(/subjects)가 쓰는 집계. 문제지 전체를 한 번 훑어야 하므로 홈 데이터와
// 같은 태그를 달아 캐싱하고, 새 업로드 시 revalidateTag("home-data")에 묻어간다.
//
// 자료가 하나도 없는 과목은 빼고 돌려준다 — 목록에 빈 과목이 섞이면 크롤러에게는
// 아무것도 없는 페이지로 가는 링크가 되고, 사용자에게는 헛걸음이 된다.
export async function getSubjectIndex(): Promise<{
  entries: SubjectIndexEntry[];
  totalCount: number;
}> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const [{ data: subjectRows }, { papers }] = await Promise.all([
    supabase.from("subjects").select("*").order("name"),
    fetchAllExamPapers(supabase),
  ]);
  const subjects = (subjectRows ?? []) as Subject[];

  const stats = new Map<
    string,
    { count: number; minYear: number; maxYear: number }
  >();
  for (const p of papers) {
    let s = stats.get(p.subject_id);
    if (!s) {
      s = { count: 0, minYear: p.year, maxYear: p.year };
      stats.set(p.subject_id, s);
    }
    s.count += 1;
    if (p.year < s.minYear) s.minYear = p.year;
    if (p.year > s.maxYear) s.maxYear = p.year;
  }

  const entries = subjects.flatMap<SubjectIndexEntry>((subject) => {
    const s = stats.get(subject.id);
    if (!s || s.count === 0) return [];
    return [
      {
        slug: subject.slug,
        name: subject.name,
        count: s.count,
        minYear: s.minYear,
        maxYear: s.maxYear,
      },
    ];
  });

  return { entries, totalCount: papers.length };
}
