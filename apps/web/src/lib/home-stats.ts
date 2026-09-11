import "server-only";
import { cacheLife } from "next/cache";
import { createPublicClient } from "@/lib/supabase/public";

// 홈 화면 상단의 "총 자료 수/누적 다운로드/누적 응시 수"는 검색어·급수와
// 무관하게 항상 같은 값인데도, 예전에는 검색창에 한 글자 칠 때마다(재렌더될 때마다)
// 매번 새로 집계하고 있었다 — 특히 두 RPC는 테이블 전체를 스캔하는 집계라 검색이
// 느려지는 원인 중 하나였다. 로그인 여부와도 무관한 완전 공개 값이라 60초간
// 캐싱해도 체감상 문제없다. (Cache Components 전환으로 unstable_cache에서
// 'use cache' 지시어로 이전 — revalidate 60초 동작은 cacheLife로 그대로 유지.)
export async function getHomeStats() {
  "use cache";
  cacheLife({ revalidate: 60 });

  const supabase = createPublicClient();
  const [{ count: totalCount }, { data: totalDownloads }, { data: totalAttempts }] =
    await Promise.all([
      supabase.from("exam_papers").select("*", { count: "exact", head: true }),
      supabase.rpc("total_download_count"),
      supabase.rpc("total_cbt_attempt_count"),
    ]);
  return { totalCount, totalDownloads, totalAttempts };
}
