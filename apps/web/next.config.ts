import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 모노레포 공유 패키지(@gongmoa/core)는 TS 소스로 배포되므로 Next 가 직접
  // 트랜스파일하도록 지정한다.
  transpilePackages: ["@gongmoa/core"],
  // Cache Components: 캐싱은 'use cache' 지시어로 명시하고, 나머지 동적 데이터는
  // Suspense 경계 뒤에서 스트리밍한다. 정적 셸을 미리 만들어 첫 표시가 빨라지고,
  // 경계가 빠진 곳은 빌드가 에러로 잡아준다.
  cacheComponents: true,
  // **주소를 미리 알려주지 않은 동적 라우트도 첫 방문 뒤에는 주소별 정적 페이지로
  // 승격시킨다** (Next 16.3 의 "ISR with Cache Components").
  //
  // 문제지 상세(/papers/[id]) 4,300장은 빌드에서 전부 프리렌더할 수 없어(장당 305KB,
  // 전부 만들면 힙 8GB 로도 OOM) generateStaticParams 에 일부만 싣는다. 나머지는
  // 주소를 모르는 채 만든 공용 fallback 셸로 나가는데, 이 옵션이 없으면 그 셸이
  // 영원히 공용으로 남는다 — 주소를 모르니 generateMetadata 가 못 돌아 <head> 에
  // 제목·정본이 없고, CDN 은 그 셸을 그대로 캐시해 크롤러에게 내준다. 켜 두면 첫
  // 요청 뒤 백그라운드에서 그 주소의 완성본(제목·정본이 <head> 에 박힌 것)을 만들어
  // 캐시에 넣고, 다음 요청부터는 그것을 내준다.
  //
  // 부수 효과: <Link> 프리페치가 링크마다가 아니라 라우트마다 한 번(App Shell)만
  // 나간다. 문제지 카드가 수십 장 깔리는 홈·과목 페이지에서는 오히려 요청이 준다.
  partialPrefetching: true,
  // 서버 액션 요청 본문 상한. 기본값이 **1MB** 라, 그대로 두면 게시판 사진·프로필
  // 사진 업로드가 휴대폰 사진(보통 2~5MB) 한 장에 그냥 막힌다(에디터에서 "사진"을
  // 눌러도 아무 일이 없던 원인).
  //
  // 4MB 로 잡은 이유: Vercel 서버리스 함수의 요청 본문 상한이 4.5MB 라 그보다 크게
  // 잡아도 플랫폼에서 먼저 잘린다. 대신 브라우저가 올리기 전에 긴 변 1600px 로 줄여
  // 보내므로(lib/prepare-image-upload.ts) 실제로는 수백 KB 밖에 오가지 않는다 —
  // 이 값은 그 축소가 실패한 파일(브라우저가 못 여는 형식 등)을 위한 여유다.
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
  // **htmlLimitedBots 에 Googlebot 을 넣지 말 것.** 2026-08-18 에 넣었다가 되돌렸다.
  //
  // 의도는 "Googlebot 에게도 메타데이터를 스트리밍하지 말고 <head> 에 담자"였는데,
  // Vercel 은 이 목록의 캐시 우회 규칙을 네이버(Yeti)·빙에는 적용하면서 Googlebot
  // 에는 적용하지 않는다(실측 2026-08-18·2026-09-02: Yeti·Bingbot x-vercel-cache=BYPASS,
  // Googlebot 은 HIT). 그래서 Googlebot 은 CDN 이 캐시한 셸을 받고 함수는 그 뒤를
  // 이어 그리는데, 함수는 "이 UA 는 블로킹 메타데이터 대상"이라고 믿어 스트리밍
  // 자리(<div hidden>)에 메타데이터를 넣지 않는다. 결과는 최악이다 — 셸의 <head>
  // 에도 없고 본문에도 없어서, Googlebot 이 받는 HTML 에는 <title>·canonical·robots
  // 가 어디에도 없다(RSC 페이로드 안에만 있다). 같은 주소를 브라우저 UA 로 받으면
  // 본문 끝에 <title>·<link rel=canonical> 이 HTML 로 실려 온다(React 가 hoist 한다).
  //
  // 서치콘솔 실측: 이 상태로 일주일 뒤 색인 페이지가 ~650 → 83 으로 떨어졌다.
  // 남은 83 은 제목·정본이 셸에 미리 박힌 홈·시험·과목 페이지뿐이었다.
  //
  // 기본값(Googlebot 은 스트리밍 대상)으로 두면 Googlebot 도 브라우저와 같은 HTML
  // 을 받는다. 근본 해결은 위의 partialPrefetching + 각 라우트의 generateStaticParams
  // 로 셸 자체에 메타데이터를 박는 것이고, 이 목록은 그 보조가 아니라 방해였다.
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
      // 기출문제 검색·목록은 2026-09 에 홈(/)에서 /papers 로 옮겼다(홈은 사이트
      // 소개 랜딩). 홈 시절의 검색 파라미터 주소(/?q=국어, /?level=9급&page=2 …)는
      // 공유 링크·북마크·검색 결과에 남아 있으므로 파라미터를 그대로 들고 /papers 로
      // 301 한다 — destination 에 쿼리를 쓰지 않으면 Next 가 원래 쿼리를 그대로
      // 넘겨준다. 파라미터가 하나도 없는 "/" 는 랜딩이므로 건드리지 않는다.
      ...["q", "level", "type", "page", "fav"].map((key) => ({
        source: "/",
        has: [{ type: "query" as const, key }],
        destination: "/papers",
        permanent: true,
      })),
    ];
  },
  // 하위 사이트맵의 **공개 주소를 루트에 둔다** — /sitemap-hubs.xml,
  // /sitemap-papers-<시험>.xml.
  //
  // 사이트맵에는 "파일이 놓인 경로가 그 파일이 담을 수 있는 주소 범위를 정한다"는
  // 규약이 있고, 구글은 여기에 서치콘솔 직접 제출에만 예외를 둔다(robots.txt 에 적는
  // 것으로는 안 풀린다). 2026-09-06 에 하위 파일을 /sitemaps/ 밑으로 내렸더니 담긴
  // 주소(/ · /papers/ · /subjects/ · /exams/)가 전부 범위 밖이 되어, 사이트맵이 내주는
  // 4,760 주소 중 구글이 아는 것이 1,559 로 주저앉고 "발견됨 - 현재 색인되지 않음"이
  // 3,776 → 0 으로 비었다. 분할 전(루트의 단일 /sitemap.xml)에는 6,000 가까이였다.
  //
  // **rewrite 를 쓰는 이유.** App Router 의 경로 조각은 통째로 정적이거나 통째로
  // 동적이어야 해서 `sitemap-[file].xml` 같은 폴더를 만들 수 없고, 시험이 22개라
  // 폴더를 하나씩 둘 수도 없다. rewrite 는 내부 전달이라 크롤러가 보는 주소는 루트
  // 그대로다(리다이렉트가 아니다 — 사이트맵을 301 로 넘기면 안 된다).
  //
  // 하이픈을 literal 로 둔 덕에 인덱스 /sitemap.xml(app/sitemap.xml/route.ts)은 여기
  // 걸리지 않는다. :file 은 `/` 를 넘지 않으므로 /sitemap-a/b 같은 주소도 안 걸린다.
  async rewrites() {
    return [
      {
        source: "/sitemap-:file",
        destination: "/sitemaps/sitemap-:file",
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
