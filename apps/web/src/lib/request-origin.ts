import "server-only";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/site-url";

// 지금 요청이 들어온 주소(스킴 + 호스트). 외부로 나갔다가 돌아와야 하는 흐름
// (소셜 로그인 콜백, 결제창의 successUrl/failUrl)에서 "돌아올 곳"을 만들 때 쓴다.
//
// lib/site-url.ts 의 SITE_URL 을 그냥 쓰면 안 되는 자리다. 그쪽은 검색엔진에 알려줄
// 정본 주소라 프리뷰 배포에서도 항상 프로덕션 주소를 내놓는다 — 프리뷰에서 결제하면
// 프로덕션으로 튕겨서 방금 만든 주문을 찾을 수 없게 된다. 로컬(localhost)도 마찬가지다.
//
// Vercel 뒤에서는 실제 호스트가 x-forwarded-host 로 온다(host 는 내부 주소일 수 있다).
//
// ── 다만 호스트 헤더는 요청에 실려 오는 값이다 ──────────────────────────────
// x-forwarded-host / host 는 클라이언트가 임의로 넣어 보낼 수 있다. 이 값이 그대로
// 결제 successUrl 이나 로그인 redirectTo 가 되면, 우리 서버가 만들어 준 주소가
// 남의 도메인을 가리키게 된다(결제 승인 키가 그쪽으로 실려 가고, "우리 사이트가 준
// 링크"라는 신뢰가 남의 화면에 붙는다). 그래서 아는 호스트일 때만 그대로 쓰고,
// 모르는 호스트면 정본 주소로 되돌린다.
export async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  return resolveOrigin({
    forwardedHost: h.get("x-forwarded-host"),
    host: h.get("host"),
    forwardedProto: h.get("x-forwarded-proto"),
    siteUrl: SITE_URL,
  });
}

// 로컬 개발. 포트는 무엇이든 좋다(3000 이 물려 있으면 Next 가 알아서 올린다).
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
// Vercel 프리뷰 배포. 매 배포마다 주소가 달라서 목록으로 못 적는다.
const VERCEL_PREVIEW_HOST = /^[a-z0-9-]+\.vercel\.app$/i;
// 호스트로 인정할 모양. 여기서 걸러 두면 헤더에 섞여 들어온 경로·공백·따옴표가
// 그대로 주소 문자열에 이어 붙는 일이 없다.
const HOST_SHAPE = /^[a-z0-9.-]+(:\d+)?$/i;

export function resolveOrigin(input: {
  forwardedHost: string | null;
  host: string | null;
  forwardedProto: string | null;
  siteUrl: string;
}): string {
  const canonical = hostOf(input.siteUrl);
  // 프록시를 여러 번 거치면 쉼표로 이어진다 — 원 발신자 자리는 맨 앞이다.
  const raw = (input.forwardedHost ?? input.host ?? "").split(",")[0].trim().toLowerCase();

  if (!isTrustedHost(raw, canonical)) return input.siteUrl;

  const protocol =
    input.forwardedProto?.split(",")[0].trim() ??
    (LOCAL_HOST.test(raw) ? "http" : "https");
  // 프로토콜도 헤더에서 온다. http/https 외의 값(javascript: 같은)은 받지 않는다.
  const safeProtocol = protocol === "http" || protocol === "https" ? protocol : "https";
  return `${safeProtocol}://${raw}`;
}

function isTrustedHost(host: string, canonical: string | null): boolean {
  if (!host || !HOST_SHAPE.test(host)) return false;
  if (canonical && (host === canonical || host === `www.${canonical}`)) return true;
  return LOCAL_HOST.test(host) || VERCEL_PREVIEW_HOST.test(host);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}
