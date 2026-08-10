import type { MetadataRoute } from "next";
import { SITE_NAME } from "@/lib/site-url";

// 홈 화면에 추가했을 때의 이름·아이콘·시작 주소. 검색 순위에 직접 쓰이지는
// 않지만, 모바일에서 "홈 화면에 추가"를 하면 브라우저 북마크가 아니라 앱처럼
// 열린다 — 기출문제를 매일 여는 수험생에게는 재방문 경로가 하나 늘어나는 셈이다.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: `${SITE_NAME} - 공무원 기출문제 자료실`,
    // 홈 화면 아이콘 밑에 붙는 이름. 길면 잘려서 두 글자로 짧게 준다.
    short_name: SITE_NAME,
    description:
      "국가직·지방직 등 공무원 기출문제를 연도별·과목별로 모아 정답·해설과 함께 무료로 제공합니다.",
    lang: "ko",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#2563eb",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      // 안드로이드는 아이콘을 원형·둥근사각 등으로 잘라내므로, 바깥이 잘려도
      // 글자가 살아남도록 여백을 더 준 판을 따로 준다.
      {
        src: "/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
