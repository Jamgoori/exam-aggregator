import { renderOgCard, OG_CONTENT_TYPE } from "@/lib/og-card";

// 홈뿐 아니라 자기 opengraph-image 가 없는 모든 하위 페이지(약관·마이페이지 등)가
// 이 이미지를 물려받는다 — 사이트 대표 카드다.
export const alt = "공모아 - 공무원 기출문제 자료실";
export const size = { width: 1200, height: 630 };
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    title: "공무원 기출문제 무료 자료실",
    subtitle: "국가직 · 지방직 · 법원직 · 경찰 · 소방",
    chips: ["정답 무료", "온라인 CBT", "해설"],
  });
}
