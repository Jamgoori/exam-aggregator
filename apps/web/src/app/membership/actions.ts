"use server";

import { getSessionUser } from "@/lib/supabase/session";
import { getRequestOrigin } from "@/lib/request-origin";
import { createPaymentOrder } from "@/lib/payments";
import { isTossConfigured, tossClientKey } from "@/lib/toss";

// 결제창을 띄우기 위해 클라이언트가 필요로 하는 값들. 금액은 서버가 정한 값을 그대로
// 내려보내고, 승인 단계에서 DB 의 금액과 다시 대조한다 — 여기서 내려간 값이 도중에
// 바뀌어도 승인이 통과하지 않는다.
export type StartCheckoutResult =
  | {
      ok: true;
      clientKey: string;
      customerKey: string;
      orderId: string;
      orderName: string;
      amount: number;
      successUrl: string;
      failUrl: string;
    }
  | { ok: false; error: string; needsLogin?: boolean };

export async function startMembershipCheckout(
  planId: string,
): Promise<StartCheckoutResult> {
  // PG 연동 전(키 미설정)에는 결제를 시작하지 않는다. 화면도 "준비 중"을 보여주지만,
  // 서버 액션은 화면을 거치지 않고 직접 부를 수 있으므로 여기서도 막는다.
  const clientKey = tossClientKey();
  if (!isTossConfigured() || !clientKey) {
    return { ok: false, error: "결제 기능은 아직 준비 중이에요." };
  }

  const { user } = await getSessionUser();
  if (!user) {
    return { ok: false, error: "로그인 후 결제할 수 있어요.", needsLogin: true };
  }

  const order = await createPaymentOrder(user.id, planId);
  if (!order.ok) return { ok: false, error: order.error };

  // 결제가 끝나고 브라우저가 돌아올 곳. 지금 요청이 들어온 주소를 그대로 쓴다 —
  // 정본 주소(SITE_URL)를 쓰면 프리뷰·로컬에서 결제했을 때 프로덕션으로 튕긴다.
  const origin = await getRequestOrigin();

  return {
    ok: true,
    clientKey,
    customerKey: order.customerKey,
    orderId: order.orderId,
    orderName: order.orderName,
    amount: order.amount,
    successUrl: `${origin}/payments/toss/success`,
    failUrl: `${origin}/payments/toss/fail`,
  };
}
