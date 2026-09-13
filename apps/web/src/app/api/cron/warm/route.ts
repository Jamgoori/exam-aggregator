import { connection } from "next/server";
import { revalidateTag } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { createPublicClient } from "@/lib/supabase/public";
import { getCachedHomeData } from "@/lib/home-data";
import {
  fetchPaperFingerprint,
  getCachedPaperFingerprint,
  paperFingerprintsDiffer,
} from "@/lib/paper-fingerprint";

// 워밍업 엔드포인트. Vercel 크론(vercel.json)이 주기적으로 호출한다.
// 목적: (1) 무료 티어 Supabase가 오래 쉬면 자동 일시정지(1주) → 첫 방문자가 몇 초
// 기다리는 걸 막고, (2) 홈 전역 데이터 캐시를 미리 데워 실제 사용자가 콜드 미스를
// 안 맞게 한다. 공개 데이터만 읽으므로 부작용은 없다.
// (Cache Components에서는 dynamic = "force-dynamic" 세그먼트 설정이 지원되지
// 않는다 — 대신 connection()을 기다려 "요청이 실제로 온 다음에 실행"임을 알린다.
// 이게 없으면 빌드가 이 핸들러를 미리 실행(프리렌더)하려다 DB를 건드린다.)

export async function GET(request: Request) {
  await connection();
  // CRON_SECRET 을 설정해두면 그 값으로만 호출을 허용한다.
  //
  // **설정하는 것을 권한다.** 안 하면 이 주소는 무인증 공개다 — 경로가 vercel.json 에
  // 적혀 있고 지오블록도 /api/** 를 통과시키므로(geo-block.ts 의 INFRA_DIRS) 누구나
  // 밖에서 두드릴 수 있고, 한 번마다 서버리스 함수 1회 + Supabase 쿼리 1회가 그대로
  // 과금된다(무료 티어 쿼터를 태우는 데 쓰인다). 새는 데이터는 없고 비용·가용성 문제다.
  //
  // 그래도 미설정을 막지는 않는다. 여기서 거절해 버리면 이 엔드포인트의 존재 이유인
  // "Supabase 자동 일시정지 방지"가 조용히 죽어서, 값을 안 넣은 배포는 첫 방문자가
  // 몇 초를 기다리게 된다 — 켜는 건 명시적인 행동이어야 하고 안 켰다고 사이트가
  // 나빠지면 안 된다. 설정 방법은 .env.local.example 참고.
  //
  // Vercel 크론은 CRON_SECRET 이 프로젝트 환경변수에 있으면 이 헤더를 자동으로 붙여
  // 보내므로, 값만 넣으면 크론 쪽은 따로 손댈 게 없다.
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (!timingSafeEqualStr(auth, `Bearer ${secret}`)) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  // Supabase에 가벼운 쿼리를 직접 날려 DB를 깨어있게 유지한다(캐시가 아직 신선하면
  // getCachedHomeData가 DB를 안 건드리므로 이 한 줄로 확실히 핑을 보낸다).
  const supabase = createPublicClient();
  await supabase.from("subjects").select("id").limit(1);

  // **CLI 업로드 반영 장치.** 문제지 캐시 수명은 7일이다(lib/cache-profiles.ts) —
  // 워밍 크론이 매일 올 때마다 4,400장을 통째로 재생성하던 것을 멈추려고 늘렸다.
  // 그 대신 `npm run bulk-upload` 같은 스크립트로 넣은 새 문제지가 최대 7일간
  // 안 보이게 되는데, 스크립트는 Next 밖에서 도니 revalidateTag 를 부를 수 없다.
  //
  // 그래서 하루 한 번 여기서 "지금 DB"와 "캐시가 아는 DB"의 지문(행 수 + 최신
  // 업로드 시각)을 맞춰 본다. 어긋날 때만 태그를 만료시키므로, 업로드가 없던 날은
  // 아무것도 재생성되지 않는다 — 이 크론(09:00 KST)이 문제지 워밍(09:30~10:00 KST)
  // 보다 먼저 도는 순서라, 만료시킨 그날의 워밍이 곧바로 새로 데운다.
  //
  // "max" = stale-while-revalidate (예전 값을 즉시 주고 뒤에서 새로 받아 교체).
  const [live, cachedFingerprint] = await Promise.all([
    fetchPaperFingerprint(),
    getCachedPaperFingerprint(),
  ]);
  const revalidated = paperFingerprintsDiffer(live, cachedFingerprint);
  if (revalidated) {
    revalidateTag("home-data", "max");
  }

  // 홈 전역 데이터 캐시를 데운다(비어있으면 채우고, stale이면 백그라운드 갱신 트리거).
  const data = await getCachedHomeData();

  return Response.json({
    ok: true,
    at: new Date().toISOString(),
    papers: data.papers.length,
    // 지문이 어긋나 태그를 만료시켰는지. 업로드한 날은 true 가 한 번 나와야 하고,
    // 아무것도 안 올린 날에 계속 true 면 지문 비교가 고장난 것이다(그 상태로 두면
    // 매일 4,400장이 재생성돼 요금이 예전으로 돌아간다).
    revalidated,
    papersInDb: live.count,
  });
}

// 상수시간 문자열 비교. 길이가 다르면 어차피 다르므로 먼저 걸러낸다(길이는 timingSafeEqual
// 이 던지는 조건이기도 하다). 비교 시간으로 토큰을 한 글자씩 알아내는 걸 막는다.
function timingSafeEqualStr(a: string | null, b: string): boolean {
  if (a === null) return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
