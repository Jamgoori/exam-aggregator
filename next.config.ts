import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
