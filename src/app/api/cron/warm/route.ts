import { connection } from "next/server";
import { createPublicClient } from "@/lib/supabase/public";
import { getCachedHomeData } from "@/lib/home-data";

// 워밍업 엔드포인트. Vercel 크론(vercel.json)이 주기적으로 호출한다.
// 목적: (1) 무료 티어 Supabase가 오래 쉬면 자동 일시정지(1주) → 첫 방문자가 몇 초
// 기다리는 걸 막고, (2) 홈 전역 데이터 캐시를 미리 데워 실제 사용자가 콜드 미스를
// 안 맞게 한다. 공개 데이터만 읽으므로 부작용은 없다.
// (Cache Components에서는 dynamic = "force-dynamic" 세그먼트 설정이 지원되지
// 않는다 — 대신 connection()을 기다려 "요청이 실제로 온 다음에 실행"임을 알린다.
// 이게 없으면 빌드가 이 핸들러를 미리 실행(프리렌더)하려다 DB를 건드린다.)

export async function GET(request: Request) {
  await connection();
  // CRON_SECRET을 설정해두면 그 값으로만 호출을 허용한다(설정 안 하면 공개 — 공개
  // 데이터만 읽고 캐시만 데우므로 위험은 낮지만, 남용 방지용으로 켜둘 수 있다).
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Supabase에 가벼운 쿼리를 직접 날려 DB를 깨어있게 유지한다(캐시가 아직 신선하면
  // getCachedHomeData가 DB를 안 건드리므로 이 한 줄로 확실히 핑을 보낸다).
  const supabase = createPublicClient();
  await supabase.from("subjects").select("id").limit(1);

  // 홈 전역 데이터 캐시를 데운다(비어있으면 채우고, stale이면 백그라운드 갱신 트리거).
  const data = await getCachedHomeData();

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    papers: data.allPapers.length,
  });
}
