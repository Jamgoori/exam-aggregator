import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { getAllCbtAvailability } from "@/lib/cbt-availability";
import type { Subject } from "@/lib/supabase/types";
import type { LightPaper } from "@/lib/paper-search";

// 홈 화면의 "무거운 전역 데이터"(문제지 전체 목록 + 과목 + CBT 가능 목록)를 한 번에
// 모아 캐싱한다. 이 셋은 로그인 여부와 무관하게 모두에게 같은 값이고, 관리자가
// 업로드할 때만 바뀐다. 예전엔 매 접속마다 문제지 1861건 전체를 조인해서 받아오느라
// (실측 1.5~3초, NANO 공유 CPU라 편차 큼) 첫 로딩이 느렸다. 5분간 캐싱하면 대부분의
// 방문자는 이 조회 없이 즉시 받고, stale-while-revalidate라 만료돼도 사용자는 기다리지
// 않는다(예전 값을 즉시 주고 뒤에서 갱신). 새 업로드 즉시 반영은 revalidateTag(
// "home-data")로 처리한다(admin/actions.ts).
//
// cookies()를 건드리지 않는 createPublicClient를 써야 'use cache' 안에서 안전하다.
// (Cache Components 전환으로 unstable_cache에서 'use cache' 지시어로 이전 —
// revalidate 300초·태그 "home-data" 동작은 cacheLife/cacheTag로 그대로 유지.)
export async function getCachedHomeData(): Promise<{
  subjects: Subject[];
  allPapers: LightPaper[];
  cbtAvailableIds: string[];
}> {
  "use cache";
  cacheLife({ revalidate: 300 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const [{ data: subjects }, allPapers, cbtAvailability] = await Promise.all([
    supabase.from("subjects").select("*").order("name"),
    fetchAllExamPapers(supabase),
    getAllCbtAvailability(supabase),
  ]);
  return {
    subjects: (subjects ?? []) as Subject[],
    allPapers,
    cbtAvailableIds: [...cbtAvailability],
  };
}
