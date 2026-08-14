import { connection, NextResponse } from "next/server";
import { markPaymentFailed } from "@/lib/payments";

// 사용자가 결제창을 닫았거나 카드사가 거절한 경우 토스가 돌려보내는 주소
// (?code=...&message=...&orderId=...). 승인 API 를 부르지 않았으므로 돈은 빠지지 않았다.
export async function GET(request: Request) {
  await connection();

  const url = new URL(request.url);
  const orderId = url.searchParams.get("orderId");
  const code = url.searchParams.get("code") ?? "UNKNOWN";
  const message = url.searchParams.get("message") ?? "";

  // 주문에는 사유를 그대로 남긴다(문의 대응용). 화면에는 우리 문구를 쓴다 — 토스가 주는
  // 메시지는 외부 입력이라 그대로 뿌리면 사용자에게 엉뚱한 말이 보이거나 문구가 주입된다.
  if (orderId) {
    await markPaymentFailed(orderId, `${code}: ${message}`.slice(0, 500));
  }

  // 사용자가 직접 취소한 것과 진짜 실패는 다르게 말해야 한다 — 자기가 닫은 창에
  // "결제에 실패했어요"가 뜨면 카드에 문제가 있는 줄 알고 다시 확인하게 된다.
  // 화면에 쓸 문구가 아니라 코드만 넘긴다(문구를 쿼리로 실으면 누구나 우리 화면에
  // 원하는 문장을 띄울 수 있다).
  const userCanceled = code === "PAY_PROCESS_CANCELED" || code === "USER_CANCEL";

  const params = new URLSearchParams({ reason: userCanceled ? "user_canceled" : "pg_failed" });
  if (orderId) params.set("order", orderId);
  return NextResponse.redirect(new URL(`/membership/complete?${params}`, url.origin));
}
