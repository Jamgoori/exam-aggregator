import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/site-url";

// 크롤 예산을 공개 콘텐츠(홈·과목 목록·문제지 상세)에만 쓰게 막아둔다.
// 아래 경로들은 색인돼도 검색 결과에 아무 가치가 없거나(로그인·회원가입),
// 로그인해야만 열리거나(마이페이지·CBT), 파일 리다이렉트라 페이지가 아니다(다운로드).
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
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
      ],
    },
    sitemap: absoluteUrl("/sitemap.xml"),
    // host 는 넣지 않는다 — 원래 Yandex 전용 비표준 지시어인 데다 값도 스킴 없는
    // 호스트명이어야 해서, 엄격한 파서에게는 robots.txt 전체가 이상해 보일 수 있다
    // (네이버 "사이트 간단 체크"가 robots.txt 를 못 찾는다고 나온 뒤 제거).
    // 정본 호스트는 next.config 의 www→apex 리다이렉트와 각 페이지 canonical 이 정한다.
  };
}
