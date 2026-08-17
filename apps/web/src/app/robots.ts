import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

// 크롤 예산을 공개 콘텐츠(홈·과목 목록·문제지 상세)에만 쓰게 막아둔다.
// 아래 경로들은 색인돼도 검색 결과에 아무 가치가 없거나(로그인·회원가입),
// 로그인해야만 열리거나(마이페이지·CBT), 파일 리다이렉트라 페이지가 아니다(다운로드).
// 사이트 전체를 막을 수집 봇.
//
// **검색엔진은 여기에 절대 넣지 말 것** — 이 사이트의 유입은 검색이 전부다.
// 아래는 "검색 결과에 우리를 올려주지 않으면서 문제지 3,800장을 통째로 긁어가는"
// 쪽만 골라 담았다. 긁는 비용은 우리가 낸다 (Vercel 실측: 사용자가 없는 6일 동안
// 함수 호출 103만 건 · 인프라 요금 $15).
//
// robots.txt 는 강제력이 없고 지키는 봇만 지킨다. 무시하는 쪽까지 막으려면
// Vercel Firewall 에서 잡아야 한다 (그쪽은 함수 호출로 집계되지도 않는다).
const BLOCKED_BOTS = [
  // AI 학습 데이터 수집. Google-Extended·Applebot-Extended 는 "학습에 쓰지 말라"는
  // 신호일 뿐 검색 색인(Googlebot·Applebot)과 별개라, 넣어도 순위에 영향이 없다.
  "GPTBot",
  "ClaudeBot",
  "anthropic-ai",
  "CCBot",
  "Google-Extended",
  "Applebot-Extended",
  "meta-externalagent",
  "FacebookBot",
  "Bytespider",
  "Amazonbot",
  "cohere-ai",
  "AI2Bot",
  "Diffbot",
  "ImagesiftBot",
  "Omgilibot",
  "PanguBot",
  "Timpibot",
  "Webzio-Extended",
  // SEO 분석 도구. 경쟁사 백링크 조사용이라 우리에게 돌아오는 것이 없다.
  // (지오블록의 크롤러 예외에도 일부러 빠져 있는 것과 같은 판단이다.)
  "AhrefsBot",
  "SemrushBot",
  "MJ12bot",
  "DotBot",
  "DataForSeoBot",
  "BLEXBot",
  "Barkrowler",
  "serpstatbot",
  "SeekportBot",
  // 국내 유입이 사실상 없는 해외 검색엔진. 크롤 양은 많다.
  "PetalBot",
  "Sogou web spider",
  "YisouSpider",
];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: BLOCKED_BOTS,
        disallow: "/",
      },
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/admin",
          "/api",
          "/auth",
          "/mypage",
          "/onboarding",
          "/login",
          "/signup",
          "/download",
          // CBT는 로그인 게이트가 걸린 풀이 화면이라 크롤러에게는 빈 껍데기다.
          "/papers/*/cbt",
          // 급수·직렬·연도 필터 탭이 만들어내는 변형 주소. 내용은 정본과 같고(각
          // 페이지 canonical이 파라미터 없는 주소를 가리킨다) 직렬 탭은 다중 선택
          // 토글이라 examTypes=A → A,B → A,B,C 로 조합이 폭발한다. 문제지 3천여
          // 장마다 이 변형이 딸리니 크롤러가 여기 갇히면 정작 사이트맵의 문제지는
          // "발견됨 - 크롤 안 됨"에 쌓인 채 방문을 못 받는다 (실측: 색인 546장일
          // 때 "표준 태그가 포함된 대체 페이지" 540장).
          //
          // ?page= 는 여기 넣지 않는다 — 내용이 실제로 다른 페이지고 자기 자신을
          // 정본으로 삼으며, 2페이지 이후에서만 링크되는 문제지의 유일한 발견
          // 경로다.
          "/*?*level=",
          "/*?*examTypes=",
          "/*?*year=",
          // 해설 페이지를 인쇄창과 함께 여는 변형. 원본이 이미 noindex라 색인
          // 가치가 없는데 크롤만 두 번 받는다.
          "/*?*download=",
        ],
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
    // host 는 넣지 않는다 — 원래 Yandex 전용 비표준 지시어인 데다 값도 스킴 없는
    // 호스트명이어야 해서, 엄격한 파서에게는 robots.txt 전체가 이상해 보일 수 있다
    // (네이버 "사이트 간단 체크"가 robots.txt 를 못 찾는다고 나온 뒤 제거).
    // 정본 호스트는 next.config 의 www→apex 리다이렉트와 각 페이지 canonical 이 정한다.
  };
}
