import type { NextConfig } from "next";
// Next 가 "메타데이터를 <head> 에 넣어 줘야 하는 봇" 목록으로 쓰는 기본 정규식.
// 여기에 Googlebot 을 더하려면 기본값을 통째로 다시 써야 해서(설정값은 교체이지
// 추가가 아니다) 소스 문자열을 가져다 쓴다.
import { HTML_LIMITED_BOT_UA_RE_STRING } from "next/dist/shared/lib/router/utils/is-bot";

const nextConfig: NextConfig = {
  // 모노레포 공유 패키지(@gongmoa/core)는 TS 소스로 배포되므로 Next 가 직접
  // 트랜스파일하도록 지정한다.
  transpilePackages: ["@gongmoa/core"],
  // Cache Components: 캐싱은 'use cache' 지시어로 명시하고, 나머지 동적 데이터는
  // Suspense 경계 뒤에서 스트리밍한다. 정적 셸을 미리 만들어 첫 표시가 빨라지고,
  // 경계가 빠진 곳은 빌드가 에러로 잡아준다.
  cacheComponents: true,
  // **Googlebot 에게도 메타데이터를 스트리밍하지 말고 <head> 에 담아 보낸다.**
  //
  // generateMetadata 가 동적인 페이지에서 Next 는 <title>·description·canonical 을
  // 셸 이후에 스트리밍하고, 그것을 <head> 로 옮기는 일은 클라이언트 React 가 한다.
  // Next 기본값은 "Googlebot 은 JS 를 실행하니 그래도 된다"이지만, 실제로는 그
  // 페이지가 렌더링 대기열에 들어가야 제목과 정본을 보게 된다 — 색인이 늦어지고
  // "발견됨 - 현재 색인되지 않음"에 그대로 쌓인다.
  //
  // 실측(2026-08-18, /papers/*·/subjects/*): Googlebot UA 로 받은 HTML 에는
  // <title>·canonical 이 하나도 없고, 같은 주소를 Yeti(네이버)·Bingbot·브라우저로
  // 받으면 정상으로 들어 있었다. 두 UA 의 차이는 이 목록뿐이다.
  //
  // 대가는 Googlebot 요청이 PPR 정적 셸 캐시를 건너뛰고 매번 동적으로 렌더된다는
  // 것이다. 두 라우트 모두 어차피 쿠키를 읽어 매 요청 렌더되므로 늘어나는 비용은
  // 사실상 없고, 색인이 걸린 문제라 이쪽이 남는 장사다.
  htmlLimitedBots: new RegExp(`Googlebot|${HTML_LIMITED_BOT_UA_RE_STRING}`),
  // www 는 정본이 아니다. Vercel 대시보드에서 www.gongmoa.kr 을 redirect 로 잡아두면
  // 여기까지 오지도 않지만, 대시보드 설정이 빠졌을 때 같은 문서가 두 주소로 200 을
  // 주며 색인이 갈리는 것을 코드에서도 막아둔다. host 매칭이라 프리뷰·로컬은 무관.
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.gongmoa.kr" }],
        destination: "https://gongmoa.kr/:path*",
        permanent: true,
      },
      // 연도 페이지(/exams/[시험]/[연도]) 248장은 2026-08-15 에 없앴다(연도는 이제
      // 시험 페이지의 ?year= 필터다). 라우트만 지우면 그 주소들이 전부 404 가 되는데,
      // 구글 서치콘솔에는 아직 "발견됨 - 현재 색인되지 않음" 목록에 남아 있고 밖에서
      // 걸린 링크·북마크도 그대로다. 내용이 옮겨간 자리가 분명히 있으므로 301 로
      // 시험 페이지에 합친다 — 연도까지 살려 ?year= 로 보내지는 않는다. 그 주소는
      // robots.txt 가 막아 둔 필터 변형이라 크롤러가 따라오지 못한다.
      {
        source: "/exams/:exam/:year(\\d{4})",
        destination: "/exams/:exam",
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          // 브라우저가 응답을 선언된 Content-Type 외의 것으로 추측(스니핑)해 실행하지 못하게 한다.
          { key: "X-Content-Type-Options", value: "nosniff" },
          // 다른 사이트가 이 사이트를 iframe에 넣어 클릭재킹하는 것을 막는다.
          { key: "X-Frame-Options", value: "DENY" },
          // 외부 사이트로 이동할 때 전체 URL(쿼리 포함)이 Referer로 새지 않게 한다.
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // 이 사이트는 카메라/마이크/위치를 전혀 쓰지 않으므로 명시적으로 차단해둔다.
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
