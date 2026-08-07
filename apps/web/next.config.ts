import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 모노레포 공유 패키지(@gongmoa/core)는 TS 소스로 배포되므로 Next 가 직접
  // 트랜스파일하도록 지정한다.
  transpilePackages: ["@gongmoa/core"],
  // Cache Components: 캐싱은 'use cache' 지시어로 명시하고, 나머지 동적 데이터는
  // Suspense 경계 뒤에서 스트리밍한다. 정적 셸을 미리 만들어 첫 표시가 빨라지고,
  // 경계가 빠진 곳은 빌드가 에러로 잡아준다.
  cacheComponents: true,
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
