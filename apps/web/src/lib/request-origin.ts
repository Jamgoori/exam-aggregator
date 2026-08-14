import "server-only";
import { headers } from "next/headers";

// 지금 요청이 들어온 주소(스킴 + 호스트). 외부로 나갔다가 돌아와야 하는 흐름
// (소셜 로그인 콜백, 결제창의 successUrl/failUrl)에서 "돌아올 곳"을 만들 때 쓴다.
//
// lib/site-url.ts 의 SITE_URL 을 쓰면 안 되는 자리다. 그쪽은 검색엔진에 알려줄
// 정본 주소라 프리뷰 배포에서도 항상 프로덕션 주소를 내놓는다 — 프리뷰에서 결제하면
// 프로덕션으로 튕겨서 방금 만든 주문을 찾을 수 없게 된다. 로컬(localhost)도 마찬가지다.
//
// Vercel 뒤에서는 실제 호스트가 x-forwarded-host 로 온다(host 는 내부 주소일 수 있다).
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const protocol =
    h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${protocol}://${host}`;
}
