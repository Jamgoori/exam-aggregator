import "server-only";
import { cacheLife } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

// 홈 화면 상단의 "총 자료 수/누적 다운로드/누적 응시 수"는 검색어·급수와
// 무관하게 항상 같은 값인데도, 예전에는 검색창에 한 글자 칠 때마다(재렌더될 때마다)
// 매번 새로 집계하고 있었다 — 특히 두 RPC는 테이블 전체를 스캔하는 집계라 검색이
// 느려지는 원인 중 하나였다. 로그인 여부와도 무관한 완전 공개 값이라 캐싱해도
// 체감상 문제없다. (Cache Components 전환으로 unstable_cache에서 'use cache'
// 지시어로 이전.)
//
// 2026-09-18: 집계 자체를 없앴다. 세 값은 DB 트리거가 미리 세어 둔 한 줄
// (site_stats)에서 나오고, 여기서는 home_stats() RPC **한 번**으로 셋을 같이
// 받는다 — 예전에는 풀스캔 세 개(exam_papers count(*)·download_count sum·
// cbt_attempts count(*))가 캐시가 만료될 때마다 돌아 디스크 IO 예산을 갉아먹었다.
// 값이 더 이상 비싸지 않으므로 수명도 60초에서 10분으로 늘렸다 (숫자 세 개가
// 10분 늦게 반영되는 건 화면상 아무 문제가 없다).
export async function getHomeStats() {
  "use cache";
  cacheLife({ revalidate: 600 });

  const supabase = createPublicClient();
  const { data } = await supabase.rpc("home_stats").maybeSingle<{
    paper_count: number;
    download_total: number;
    cbt_attempt_count: number;
  }>();
  return {
    totalCount: data?.paper_count ?? null,
    totalDownloads: data?.download_total ?? null,
    totalAttempts: data?.cbt_attempt_count ?? null,
  };
}
