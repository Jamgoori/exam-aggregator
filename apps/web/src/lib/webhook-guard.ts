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

export type RateLimiter = {
  /** 이번 요청을 처리해도 되는지. false 면 한도 초과. */
  take(key: string, now?: number): boolean;
};

/**
 * 고정 창(fixed window) 유량 제한.
 *
 * 서버리스라 인스턴스마다 각자 세므로 전역 한도가 아니다 — 그래도 인스턴스 하나가
 * 감당할 수 있는 최대 증폭은 이걸로 묶인다. 정확한 전역 제한이 필요하면 저장소가
 * 필요한데, 웹훅 한 줄 때문에 Redis 를 들이는 건 과하다.
 *
 * 한도는 넉넉해야 한다. 여기에 걸려서 **진짜 결제 웹훅이 버려지면** 돈은 받고 멤버십은
 * 안 켜진 주문이 생긴다 — 공격을 조금 덜 막는 것보다 그쪽이 훨씬 나쁘다.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** 메모리 상한. 넘으면 만료된 것부터 비우고, 그래도 넘으면 통째로 비운다. */
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    take(key: string, now: number = Date.now()): boolean {
      const current = windows.get(key);
      if (!current || now >= current.resetAt) {
        if (windows.size >= maxKeys) evict(windows, now, maxKeys);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      current.count++;
      return current.count <= limit;
    },
  };
}

function evict(
  windows: Map<string, { count: number; resetAt: number }>,
  now: number,
  maxKeys: number,
) {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  // 만료된 게 없을 만큼 몰렸다면(=공격 중) 통째로 비운다. 여기서 붙잡고 있어 봐야
  // 메모리만 먹고, 비워도 다음 창에서 다시 세기 시작한다.
  if (windows.size >= maxKeys) windows.clear();
}

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
