import { connection, NextResponse } from "next/server";
import { settleTossPayment } from "@/lib/payments";

// 결제창이 성공으로 끝나면 토스가 사용자 브라우저를 이 주소로 돌려보낸다
// (?paymentKey=...&orderId=...&amount=...). **여기서 승인 API 를 부르기 전까지는 돈이
// 빠지지 않는다** — 결제창이 닫혔다고 결제가 끝난 게 아니다.
//
// 로그인 세션을 확인하지 않는다. 멤버십은 세션의 사용자가 아니라 주문에 적힌
// payments.user_id 에게 부여하므로, 남이 이 주소를 열어도 얻는 게 없다(승인은 유효한
// paymentKey 가 있어야 통과하고, 통과해도 기간은 주문의 주인에게 간다). 반대로 세션을
// 요구하면 결제 도중 세션이 만료된 사용자의 결제를 우리가 승인하지 못한 채 남기게 되는데,
// 그건 사용자가 결제 절차를 다 밟았는데 우리 사정으로 무산시키는 셈이라 더 나쁘다.
export async function GET(request: Request) {
  // 이 핸들러는 요청이 실제로 온 뒤에만 의미가 있다(빌드 때 미리 실행되면 안 된다).
  await connection();

  const url = new URL(request.url);
  const paymentKey = url.searchParams.get("paymentKey");
  const orderId = url.searchParams.get("orderId");
  const amount = Number(url.searchParams.get("amount"));

  if (!paymentKey || !orderId) {
    return toResult(url.origin, null, "not_found");
  }

  const result = await settleTossPayment({ orderId, paymentKey, amountFromPg: amount });
  return toResult(url.origin, orderId, result.ok ? null : result.reason);
}

// 결과 화면으로 넘긴다. 승인 처리와 결과 표시를 나눠 두면 사용자가 새로고침해도
// 승인이 다시 돌지 않는다(결과 화면은 DB 를 읽기만 한다).
//
// 실패는 코드로만 넘긴다 — 쿼리에 문장을 실으면 누구나 이 주소를 만들어 우리 화면에
// 원하는 문구를 띄울 수 있다.
function toResult(origin: string, orderId: string | null, reason: string | null) {
  const params = new URLSearchParams();
  if (orderId) params.set("order", orderId);
  if (reason) params.set("reason", reason);
  return NextResponse.redirect(new URL(`/membership/complete?${params}`, origin));
}
