import "server-only";
import { unstable_cache } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import { getAllCbtAvailability } from "@/lib/cbt-availability";
import type { Subject } from "@/lib/supabase/types";
import { encodePapers, type HomePayload } from "@/lib/paper-search";

// 홈 화면의 "무거운 전역 데이터"(문제지 전체 목록 + 과목 + CBT 가능 목록)를 한 번에
// 모아 캐싱한다. 이 셋은 로그인 여부와 무관하게 모두에게 같은 값이고, 관리자가
// 업로드할 때만 바뀐다. 예전엔 매 접속마다 문제지 1861건 전체를 조인해서 받아오느라
// (실측 1.5~3초, NANO 공유 CPU라 편차 큼) 첫 로딩이 느렸다. 5분간 캐싱하면 대부분의
// 방문자는 이 조회 없이 즉시 받고, stale-while-revalidate라 만료돼도 사용자는 기다리지
// 않는다(예전 값을 즉시 주고 뒤에서 갱신). 새 업로드 즉시 반영은 revalidateTag(
// "home-data")로 처리한다(admin/actions.ts).
//
// cookies()를 건드리지 않는 createPublicClient를 써야 unstable_cache 안에서 안전하다.
//
// 캐시에 담는 값 자체도 클라이언트로 보내는 압축 표현(PaperWire) 그대로 둔다 —
// 캐시 엔트리 크기 한도(Vercel Data Cache는 엔트리당 2MB)에 걸리면 캐싱이 조용히
// 스킵돼 모든 방문자가 풀 조회를 기다리게 되는데, 자료가 계속 늘어나는 중이라
// 여유를 크게 잡아둬야 한다.
export const getCachedHomeData = unstable_cache(
  async (): Promise<HomePayload & { cbtMask: string }> => {
    const supabase = createPublicClient();
    const [{ data: subjectRows }, { papers, examTypes }, cbtAvailability] =
      await Promise.all([
        supabase.from("subjects").select("*").order("name"),
        fetchAllExamPapers(supabase),
        getAllCbtAvailability(supabase),
      ]);
    const subjects = (subjectRows ?? []) as Subject[];
    return {
      subjects,
      examTypes,
      papers: encodePapers(papers, subjects, examTypes),
      // "바로 풀기" 대상은 사실상 거의 모든 문제지라, UUID 목록으로 보내면 그것만
      // 130KB에 달했다. 문제지 목록과 같은 순서의 0/1 문자열로 보내면 문제지당
      // 1바이트로 끝난다(클라이언트에서 다시 id 집합으로 복원).
      cbtMask: papers.map((p) => (cbtAvailability.has(p.id) ? "1" : "0")).join(""),
    };
  },
  // 캐시에 담기는 값의 모양이 바뀌면 키 뒤 버전을 올린다 — 안 올리면 배포 직후
  // 예전 모양으로 캐시된 값이 그대로 돌아와 화면이 깨진다.
  ["home-data-v3"],
  { revalidate: 300, tags: ["home-data"] },
);
