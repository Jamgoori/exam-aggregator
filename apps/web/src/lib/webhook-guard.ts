// 공개 웹훅 엔드포인트를 지키는 장치들 — 순수 로직만(테스트: webhook-guard.test.ts).
//
// 토스 결제 웹훅(/api/payments/toss/webhook)은 인증이 없다. 토스가
// PAYMENT_STATUS_CHANGED 에 서명을 붙여 주지 않기 때문이다. 그래서 이 앱은 본문을
// 믿지 않고 paymentKey 로 토스에 다시 물어본다(lib/payments.ts) — 위조된 "결제 완료"
// JSON 으로 멤버십을 받아가는 경로는 그걸로 막힌다.
//
// 다만 그 구조에는 남는 문제가 하나 있다: **요청 한 번이 토스 API 호출 한 번이 된다.**
// 주소만 알면 누구나 초당 수천 번 두드려 우리 이름으로 토스 API 를 때릴 수 있고,
// 토스가 우리를 레이트리밋하면 그때 들어온 진짜 결제의 상태 동기화가 실패한다.
// 여기 있는 세 가지가 그 사이를 좁힌다.
//
//  1) paymentKey 형식 검사  — 형식이 아니면 토스에 묻지도 않는다(공짜로 걸러진다).
//  2) 발신 IP 허용 목록     — 토스 개발자센터가 공지하는 웹훅 발신 IP. 환경변수로
//                            넣어 두면 그 밖의 요청은 조회 자체를 하지 않는다.
//  3) IP 당 유량 제한       — 목록을 안 넣었을 때의 최후 방어선.

// 토스 paymentKey 형식. 문서 기준 최대 200자, 영문·숫자·`-`·`_`.
// 조회 경로에 그대로 들어가는 값이라 여기서 좁혀 두면 경로 조작 여지도 같이 사라진다.
const PAYMENT_KEY = /^[A-Za-z0-9_-]{1,200}$/;

export function isValidPaymentKey(key: unknown): key is string {
  return typeof key === "string" && PAYMENT_KEY.test(key);
}

// 발신 IP 허용 목록. 비어 있으면(기본) IP 로는 거르지 않는다 — 목록을 코드에 박으면
// 토스가 IP 를 바꾸는 날 웹훅이 통째로 조용히 죽는다. 값은 운영자가 토스 개발자센터의
// 공지를 보고 환경변수(TOSS_WEBHOOK_IPS)에 넣는다.
export function parseIpAllowlist(raw: string | undefined | null): Set<string> {
  return new Set(
    (raw ?? "")
      .split(",")
      .map((ip) => ip.trim())
      .filter(Boolean),
  );
}

export function isAllowedIp(ip: string | null, allowlist: Set<string>): boolean {
  if (allowlist.size === 0) return true; // 목록 미설정 = 검사 안 함
  return ip !== null && allowlist.has(ip);
}

// 유량 제한은 lib/rate-limit.ts 로 옮겼다(비회원 댓글 비밀번호 대입 방지에서도 쓴다).
// 여기서 다시 내보내 기존 사용처와 테스트의 import 를 그대로 둔다.
export { createRateLimiter, type RateLimiter } from "./rate-limit";

/**
 * 요청을 보낸 쪽의 IP.
 *
 * x-real-ip 를 먼저 본다. Vercel 이 직접 채우는 단일 값이라, 클라이언트가 넣어 보낸
 * x-forwarded-for 사슬보다 손대기 어렵다. 없으면 x-forwarded-for 의 첫 항목을 쓴다
 * (프록시 앞단이 붙인 원 발신자 자리).
 */
export function requestIp(headers: {
  get(name: string): string | null;
}): string | null {
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim() || null;
  return null;
}
