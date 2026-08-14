import "server-only";

// 토스페이먼츠 API 클라이언트(서버 전용).
//
// 시크릿 키는 절대 클라이언트로 내보내지 않는다 — 이 키 하나로 임의의 결제를 승인하고
// 취소할 수 있다. 그래서 이 파일은 server-only 이고, 클라이언트가 필요로 하는 건
// 공개 키(NEXT_PUBLIC_TOSS_CLIENT_KEY) 뿐이다.
//
// 키가 설정되지 않은 환경(= PG 심사 전)에서는 isTossConfigured() 가 false 를 돌려주고,
// 결제 화면은 예전처럼 "준비 중" 안내를 보여준다. 배포해도 안전하도록 만든 장치다 —
// 계약이 끝나기 전에 이 코드가 프로덕션에 올라가더라도 결제창이 열리지 않는다.

const API_BASE = "https://api.tosspayments.com/v1";

export function tossClientKey(): string | null {
  return process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY || null;
}

function tossSecretKey(): string | null {
  return process.env.TOSS_SECRET_KEY || null;
}

// 결제 기능을 열지 말지의 유일한 판정. 두 키가 다 있어야 결제창부터 승인까지 완주할
// 수 있다 — 하나만 있으면 결제창은 뜨는데 승인이 실패하는, 최악의 반쪽 상태가 된다.
export function isTossConfigured(): boolean {
  return !!tossClientKey() && !!tossSecretKey();
}

// 토스 인증 헤더. 시크릿 키를 아이디로 쓰는 HTTP Basic (비밀번호는 빈 문자열).
function authHeader(secretKey: string): string {
  return `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
}

// 토스가 돌려주는 결제 객체 중 우리가 실제로 쓰는 필드만. 전체를 타입으로 옮겨 적으면
// 토스가 필드를 추가할 때마다 타입이 낡는다 — 원본은 payments.raw 에 통째로 남긴다.
export type TossPayment = {
  paymentKey: string;
  orderId: string;
  status: string; // READY | IN_PROGRESS | DONE | CANCELED | PARTIAL_CANCELED | ABORTED | EXPIRED
  totalAmount: number;
  // 취소하고 남은 금액. 전액 취소면 0 이다. cancels 배열을 더하는 것보다 이쪽이 정확하다
  // (부분 취소가 여러 번 일어난 경우까지 토스가 계산해 준 값이라서).
  balanceAmount: number;
  method?: string | null;
  approvedAt?: string | null;
  receipt?: { url?: string | null } | null;
};

export type TossResult =
  | { ok: true; payment: TossPayment; raw: unknown }
  | { ok: false; code: string; message: string; raw: unknown };

// 토스 에러 응답은 { code, message }. 우리 화면에 그대로 노출하지는 않지만(외부 문구라
// 사용자에게 뜬금없는 말이 될 수 있다) 로그·문의 대응을 위해 보존한다.
function parseError(body: unknown, fallback: string): { code: string; message: string } {
  if (body && typeof body === "object") {
    const b = body as { code?: unknown; message?: unknown };
    return {
      code: typeof b.code === "string" ? b.code : "UNKNOWN",
      message: typeof b.message === "string" ? b.message : fallback,
    };
  }
  return { code: "UNKNOWN", message: fallback };
}

async function callToss(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown; idempotencyKey?: string },
): Promise<TossResult> {
  const secretKey = tossSecretKey();
  if (!secretKey) {
    return { ok: false, code: "NOT_CONFIGURED", message: "결제가 설정되지 않았어요.", raw: null };
  }

  const headers: Record<string, string> = { Authorization: authHeader(secretKey) };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  // 같은 요청이 두 번 가도 결제가 두 번 일어나지 않게 한다. 네트워크가 끊겨 재시도하는
  // 경우가 실제로 생기고, 그때 중복 승인되면 돈이 두 번 빠진다.
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      // 결제 승인은 캐시 대상이 아니다.
      cache: "no-store",
    });
  } catch {
    // 네트워크 실패. 승인이 갔는지 안 갔는지 알 수 없는 상태라, 호출부는 이걸
    // "성공"으로 처리하면 안 된다(웹훅이 나중에 실제 상태를 알려준다).
    return {
      ok: false,
      code: "NETWORK_ERROR",
      message: "결제사와 통신하지 못했어요.",
      raw: null,
    };
  }

  const raw: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const { code, message } = parseError(raw, `결제사 오류 (HTTP ${res.status})`);
    return { ok: false, code, message, raw };
  }
  return { ok: true, payment: raw as TossPayment, raw };
}

// 결제 승인. 이걸 호출해야 실제로 돈이 빠진다 — 결제창을 닫은 것만으로는 승인되지 않는다.
//
// amount 는 반드시 우리 DB(payments.amount)의 값을 넘긴다. 리다이렉트 쿼리로 돌아온
// 금액을 그대로 넘기면 금액 검증이 무의미해진다(공격자가 고친 값을 우리가 승인해 준다).
export function confirmTossPayment(params: {
  paymentKey: string;
  orderId: string;
  amount: number;
}): Promise<TossResult> {
  return callToss("/payments/confirm", {
    method: "POST",
    body: params,
    idempotencyKey: `confirm-${params.orderId}`,
  });
}

// 결제 재조회. 웹훅 본문을 믿지 않고 이걸로 실제 상태를 확인하는 용도다 —
// 웹훅 엔드포인트는 공개되어 있어서 아무나 "결제 완료" 모양의 JSON 을 보낼 수 있다.
export function fetchTossPayment(paymentKey: string): Promise<TossResult> {
  return callToss(`/payments/${encodeURIComponent(paymentKey)}`, { method: "GET" });
}
