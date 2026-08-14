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

// 토스 키는 "종류"와 "모드"가 접두사에 박혀 있다.
//   test_gck_ / test_gsk_ — 주문서형·결제창형 연동 키 (v2 SDK 가 쓰는 것)
//   test_ck_  / test_sk_  — API 개별 연동 키 (기존 결제창·빌링·정산 API 용)
// 앞의 test/live 가 모드, 뒤의 g 유무가 종류다.
function parseTossKey(
  key: string,
): { mode: string; family: string; role: "client" | "secret" } | null {
  const m = /^(test|live)_(g?)(ck|sk)_/.exec(key);
  if (!m) return null;
  return {
    mode: m[1],
    family: m[2] === "g" ? "general" : "api",
    role: m[3] === "ck" ? "client" : "secret",
  };
}

// 클라이언트 키와 시크릿 키가 같은 쌍인지 검사한다.
//
// 이게 왜 필요한가: 토스 대시보드는 서로 다른 두 쌍(주문서형용 gck/gsk, API 개별
// 연동용 ck/sk)을 한 화면에 나란히 보여준다. 복사하다 한 줄씩 어긋나게 집기 쉽고,
// 어긋나면 **결제창은 정상으로 뜨는데 승인 단계에서만 실패한다** — 사용자가 카드
// 정보를 다 넣고 인증까지 마친 다음에야 깨지는, 가장 나쁜 자리에서 터진다.
//
// 더 위험한 건 모드가 섞이는 경우다. live 클라이언트 키 + test 시크릿 키면 사용자는
// 실제 카드로 결제하는데 우리는 테스트 환경에 승인을 요청하게 된다.
//
// 어긋나면 결제를 아예 열지 않는다(화면은 "준비 중"으로 남는다). 반쪽으로 열어두는
// 것보다 닫아두는 쪽이 낫다.
export function keysMatch(clientKey: string, secretKey: string): boolean {
  const client = parseTossKey(clientKey);
  const secret = parseTossKey(secretKey);
  if (!client || !secret) return false;

  // 각자 제 역할의 키인지부터 본다. 시크릿 키가 NEXT_PUBLIC_ 자리에 들어가는 것은
  // 단순 오설정이 아니라 시크릿 유출이다 — NEXT_PUBLIC_ 값은 브라우저 번들에 그대로
  // 박혀서 모든 방문자에게 배포된다. 여기서 막아 결제 자체를 열지 않는다.
  if (client.role !== "client" || secret.role !== "secret") return false;

  return client.mode === secret.mode && client.family === secret.family;
}

// 결제 기능을 열지 말지의 유일한 판정. 두 키가 다 있고 서로 같은 쌍이어야 결제창부터
// 승인까지 완주할 수 있다.
export function isTossConfigured(): boolean {
  const clientKey = tossClientKey();
  const secretKey = tossSecretKey();
  if (!clientKey || !secretKey) return false;

  if (!keysMatch(clientKey, secretKey)) {
    // 설정 실수는 조용히 넘어가면 안 된다. 화면만 보면 "아직 연동 안 했나 보다"로
    // 보여서, 키를 넣어놓고 왜 안 열리는지 한참 헤매게 된다.
    console.error(
      "[toss] 클라이언트 키와 시크릿 키가 같은 쌍이 아닙니다. 결제를 열지 않습니다. " +
        "(주문서형은 gck/gsk 끼리, API 개별 연동은 ck/sk 끼리, test/live 모드도 일치해야 합니다)",
    );
    return false;
  }
  return true;
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
