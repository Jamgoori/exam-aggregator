import { adsTxtBody } from "@/lib/adsense";

// /ads.txt — "이 도메인의 광고 재고를 팔 권한이 있는 회사"를 적어 두는 IAB 표준 파일.
// 애드센스가 승인 직후부터 이걸 찾고, 없으면 대시보드에 "수익 손실 위험" 경고를 띄운다
// (광고주 일부가 ads.txt 없는 사이트에 입찰하지 않는다).
//
// public/ads.txt 로 두지 않은 이유: 게시자 ID 를 lib/adsense.ts 한 곳에서만 관리하려는
// 것이다. 정적 파일로 두면 같은 ID 가 ads.txt 와 로더 스크립트 두 곳에 각각 적히고,
// 한쪽만 고치는 사고가 난다(lib/adsense.ts 머리 주석).
//
// Cache Components 에서 GET 라우트는 동적 데이터를 읽지 않으면 알아서 프리렌더된다 —
// 그래서 dynamic = 'force-static' 같은 설정은 붙이지 않는다(Next 16 규칙).
//
// 확장자가 .txt 라 프록시 matcher(src/proxy.ts)에서 제외되고, 지오블록 판정에서도
// 설비 경로로 통과한다(lib/geo-block.ts 의 INFRA_FILES) — 구글 크롤러는 미국 IP 라
// 둘 중 하나만 빠져도 조용히 403 이 된다.
export function GET() {
  const body = adsTxtBody();

  // 게시자 ID 가 없으면(애드센스 승인 전) 빈 파일을 내주는 대신 404 를 준다.
  // 내용 없는 ads.txt 는 "아무 회사도 이 도메인의 광고를 팔 수 없다"는 선언이라,
  // 나중에 광고를 켰을 때 입찰이 막히는 쪽이 더 나쁘다.
  if (!body) return new Response("Not Found", { status: 404 });

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // 크롤러만 읽는 문서라 CDN 이 한동안 들고 있어도 된다(sitemap·rss 와 같은 정책).
      "cache-control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
