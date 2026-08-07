// 사이트의 정본(canonical) 절대 주소. canonical 링크·sitemap·robots·OG 이미지는
// 상대 경로로 쓸 수 없어서 한 군데에서 절대 주소를 만들어 쓴다.
//
// 우선순위:
//  1. NEXT_PUBLIC_SITE_URL — 도메인을 바꿀 때만 쓰는 탈출구.
//  2. 아래 PRODUCTION_URL — 구매한 도메인 gongmoa.kr. Vercel 위(프로덕션·프리뷰
//     모두)에서 쓴다. VERCEL_PROJECT_PRODUCTION_URL(= *.vercel.app)을 쓰면
//     커스텀 도메인을 붙여도 canonical이 vercel.app을 가리켜 색인이 갈린다.
//     프리뷰도 프로덕션 주소를 canonical로 내보내야 중복 색인되지 않는다.
//  3. 로컬 개발 폴백.
const PRODUCTION_URL = "https://gongmoa.kr";

const RAW =
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL ? PRODUCTION_URL : "http://localhost:3000");

export const SITE_URL = RAW.replace(/\/+$/, "");

export const SITE_NAME = "공모아";

export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}
