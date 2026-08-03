// 사이트의 정본(canonical) 절대 주소. canonical 링크·sitemap·robots·OG 이미지는
// 상대 경로로 쓸 수 없어서 한 군데에서 절대 주소를 만들어 쓴다.
//
// 우선순위:
//  1. NEXT_PUBLIC_SITE_URL — 커스텀 도메인을 사면 여기에만 넣으면 전부 따라간다.
//  2. VERCEL_PROJECT_PRODUCTION_URL — Vercel이 자동 주입하는 "프로덕션" 도메인.
//     VERCEL_URL(배포마다 바뀌는 주소)이 아니라 이걸 써야 프리뷰 배포에서도
//     canonical이 프로덕션을 가리켜, 프리뷰 URL이 검색에 중복 색인되지 않는다.
//  3. 로컬 개발 폴백.
const RAW =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : "http://localhost:3000");

export const SITE_URL = RAW.replace(/\/+$/, "");

export const SITE_NAME = "공모아";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
