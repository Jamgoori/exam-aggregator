import { connection } from "next/server";
import { syncTossPaymentByKey } from "@/lib/payments";
import { isTossConfigured } from "@/lib/toss";

// 토스 결제 상태 변경 웹훅.
//
// 이게 왜 필요한가: successUrl 리다이렉트는 사용자 브라우저를 거치므로 유실될 수 있다.
// 결제창에서 승인 버튼을 누른 직후 브라우저를 닫거나, 지하철에서 네트워크가 끊기면
// 우리는 결제된 사실을 영영 모른다 — 돈은 빠졌는데 멤버십은 안 켜진 상태가 된다.
// 웹훅은 토스 서버가 우리 서버로 직접 쏘기 때문에 그 경우에도 도착한다.
//
// 보안: **본문을 믿지 않는다.** 이 주소는 공개되어 있어서 누구나 "결제 완료" 모양의
// JSON 을 보낼 수 있다. 본문에서 paymentKey 만 꺼내 토스 API 에 직접 다시 물어보고,
// 그 응답만 진실로 취급한다(lib/payments.ts 의 syncTossPaymentByKey). 위조된 키는
// 조회 단계에서 걸러지고, 남의 실제 키를 넣어도 주문 금액이 맞지 않으면 무시된다.
//
// 토스 웹훅 등록: 개발자센터 → 웹훅 → `https://gongmoa.kr/api/payments/toss/webhook`,
// 이벤트는 PAYMENT_STATUS_CHANGED.
export async function POST(request: Request) {
  await connection();

  // 키가 없으면 토스에 되물을 수단이 없다. 조용히 200 으로 받아 넘긴다 — 에러를 주면
  // 토스가 재시도를 계속 쌓는다.
  if (!isTossConfigured()) return Response.json({ ok: true });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: true });
  }

  const paymentKey = extractPaymentKey(body);
  if (paymentKey) {
    try {
      await syncTossPaymentByKey(paymentKey);
    } catch {
      // 처리에 실패해도 200 을 준다. 500 을 주면 토스가 같은 웹훅을 반복해서 보내는데,
      // 우리 쪽 일시적 장애라면 재시도가 도움이 되지만 영구적 오류라면 무한히 쌓인다.
      // 결제 상태는 사용자가 화면에 들어올 때 successUrl 경로에서도 확인되므로,
      // 여기서 한 번 놓쳐도 복구 경로가 남아 있다.
    }
  }

  // 토스는 2xx 를 받아야 성공으로 본다.
  return Response.json({ ok: true });
}

// { eventType: "PAYMENT_STATUS_CHANGED", data: { paymentKey, ... } } 형태.
// 외부 입력이라 모양을 가정하지 않고 확인하며 꺼낸다.
function extractPaymentKey(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const key = (data as { paymentKey?: unknown }).paymentKey;
  return typeof key === "string" && key.length > 0 ? key : null;
}
