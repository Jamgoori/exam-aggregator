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
    sitemap: absoluteUrl("/sitemap.xml"),
    // host 는 넣지 않는다 — 원래 Yandex 전용 비표준 지시어인 데다 값도 스킴 없는
    // 호스트명이어야 해서, 엄격한 파서에게는 robots.txt 전체가 이상해 보일 수 있다
    // (네이버 "사이트 간단 체크"가 robots.txt 를 못 찾는다고 나온 뒤 제거).
    // 정본 호스트는 next.config 의 www→apex 리다이렉트와 각 페이지 canonical 이 정한다.
  };
}
