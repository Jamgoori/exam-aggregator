import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmTossPayment, fetchTossPayment, type TossPayment } from "@/lib/toss";
import {
  findPlan,
  grantedExpiry,
  membershipFromRow,
  revokedExpiry,
  type PaymentStatus,
  type PlanId,
} from "@gongmoa/core";

// 결제의 서버측 처리 — 주문 생성, 승인, 취소 반영.
//
// 이 파일의 모든 쓰기는 service_role 로 한다. payments·memberships 에는 쓰기 정책이
// 없어서(schema.sql 참고) 클라이언트가 직접 올릴 수 없고, 올릴 수 있으면 결제 없이
// 프리미엄이 된다.
//
// 두 개의 진입 경로가 같은 결제를 동시에 처리할 수 있다는 것이 이 파일의 전제다:
//   1. 결제창이 끝나고 사용자 브라우저가 돌아오는 successUrl (빠르지만 유실될 수 있다 —
//      승인 직후 브라우저를 닫거나 네트워크가 끊기면 안 온다)
//   2. 토스가 서버로 직접 쏘는 웹훅 (느리지만 확실하다)
// 그래서 "두 번 처리해도 결과가 같아야 한다"가 모든 함수의 요구사항이고, 실제 보장은
// DB 함수(apply_paid_membership / revoke_paid_membership)의 행 잠금이 해준다.

export type PaymentRow = {
  order_id: string;
  user_id: string;
  plan_id: string;
  months: number;
  amount: number;
  status: PaymentStatus;
  payment_key: string | null;
  method: string | null;
  receipt_url: string | null;
  paid_at: string | null;
  granted_at: string | null;
  canceled_at: string | null;
  fail_reason: string | null;
  created_at: string;
};

const PAYMENT_COLUMNS =
  "order_id, user_id, plan_id, months, amount, status, payment_key, method, receipt_url, paid_at, granted_at, canceled_at, fail_reason, created_at";

// 주문번호. 토스 제약은 6~64자 / 영문·숫자·`-`·`_` 다.
// 시각(36진수)을 앞에 둬서 정렬하면 시간순이 되고, 뒤의 난수가 충돌을 막는다.
// 사용자 id 는 넣지 않는다 — 주문번호는 결제창 URL 을 통해 노출되는 값이다.
function newOrderId(): string {
  return `gm-${Date.now().toString(36)}-${randomBytes(8).toString("hex")}`;
}

// 토스에 넘길 고객 식별자. 같은 사람이 다시 결제할 때 간편결제 수단을 이어 쓰게 해준다.
//
// 사용자 id 를 그대로 넘기지 않고 해시한다. 토스 가이드가 고객키에 개인을 식별할 수
// 있는 값을 쓰지 말라고 하고, 이 값은 결제창(외부)으로 나가는 값이라 우리 내부 id 를
// 그대로 내보낼 이유가 없다. 해시는 계정마다 고정이라 "같은 사람"은 계속 유지된다.
function customerKeyFor(userId: string): string {
  return createHash("sha256").update(`gongmoa:customer:${userId}`).digest("hex").slice(0, 32);
}

export type CreateOrderResult =
  | {
      ok: true;
      orderId: string;
      amount: number;
      orderName: string;
      customerKey: string;
    }
  | { ok: false; error: string };

// 결제창을 띄우기 전에 주문을 만든다. 금액·개월 수는 여기서 서버가 정하고, 이후
// 승인 단계는 이 행에 적힌 값만 믿는다.
export async function createPaymentOrder(
  userId: string,
  planId: string,
): Promise<CreateOrderResult> {
  const plan = findPlan(planId);
  if (!plan) return { ok: false, error: "요금제를 찾을 수 없어요." };

  const orderId = newOrderId();
  const { error } = await createAdminClient().from("payments").insert({
    order_id: orderId,
    user_id: userId,
    plan_id: plan.id satisfies PlanId,
    months: plan.months,
    amount: plan.price,
    status: "ready",
    provider: "toss",
  });
  if (error) return { ok: false, error: "결제를 시작하지 못했어요. 잠시 후 다시 시도해주세요." };

  return {
    ok: true,
    orderId,
    amount: plan.price,
    // 결제창과 카드사 문자에 찍히는 이름. 무엇을 샀는지 알아볼 수 있어야 한다.
    orderName: `공모아 멤버십 ${plan.label}`,
    customerKey: customerKeyFor(userId),
  };
}

export async function getPaymentByOrderId(orderId: string): Promise<PaymentRow | null> {
  const { data } = await createAdminClient()
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as PaymentRow | null) ?? null;
}

// 사용자가 결제창을 닫았거나 카드사가 거절한 경우. 승인 자체를 시도하지 않았으므로
// 돈은 빠지지 않았다 — 기록만 남긴다.
//
// 이미 승인된(paid) 주문은 건드리지 않는다. 실패 콜백이 늦게 도착하는 경우가 있는데
// 그걸로 성공한 결제를 실패로 덮으면, 돈은 받았는데 실패로 기록된 주문이 된다.
export async function markPaymentFailed(orderId: string, reason: string): Promise<void> {
  await createAdminClient()
    .from("payments")
    .update({
      status: "failed",
      fail_reason: reason.slice(0, 500),
      updated_at: new Date().toISOString(),
    })
    .eq("order_id", orderId)
    .eq("status", "ready");
}

// 승인된 결제를 멤버십 기간으로 반영한다. 만료 계산은 core 의 grantedExpiry 하나에서
// 오고, 실제 쓰기는 DB 함수가 한 트랜잭션으로 처리한다(중복 부여 방지).
async function grantMembershipFor(row: PaymentRow): Promise<void> {
  const admin = createAdminClient();

  const { data: membershipRow } = await admin
    .from("memberships")
    .select("tier, source, started_at, expires_at")
    .eq("user_id", row.user_id)
    .maybeSingle();

  const expiresAt = grantedExpiry(membershipFromRow(membershipRow ?? null), row.months);

  // 반환값은 'applied' | 'already' | 'not_paid' | 'not_found'. 'already' 는 정상이다
  // (리다이렉트와 웹훅이 겹친 경우) — 두 번째 호출이 아무 일도 하지 않았다는 뜻이다.
  await admin.rpc("apply_paid_membership", {
    p_order_id: row.order_id,
    p_expires_at: expiresAt,
  });
}

// 전액 취소(환불)를 멤버십에 반영한다. 부여할 때 더한 개월 수를 그대로 뺀다.
async function revokeMembershipFor(row: PaymentRow): Promise<void> {
  const admin = createAdminClient();

  const { data: membershipRow } = await admin
    .from("memberships")
    .select("tier, source, started_at, expires_at")
    .eq("user_id", row.user_id)
    .maybeSingle();

  const expiresAt = revokedExpiry(membershipFromRow(membershipRow ?? null), row.months);

  await admin.rpc("revoke_paid_membership", {
    p_order_id: row.order_id,
    p_expires_at: expiresAt,
  });
}

// PG 가 알려준 결제 상태를 우리 DB 에 반영한다. 승인 직후(리다이렉트)와 웹훅이 모두
// 이 함수로 모인다 — 상태 해석이 두 곳에 따로 있으면 한쪽만 고쳐지고 어긋난다.
//
// payment 는 반드시 "토스에 직접 물어본" 값이어야 한다. 웹훅 본문을 그대로 넘기면
// 아무나 결제 완료 모양의 JSON 을 보내 프리미엄을 받아갈 수 있다.
async function applyTossPaymentState(
  row: PaymentRow,
  payment: TossPayment,
  raw: unknown,
): Promise<PaymentStatus> {
  const admin = createAdminClient();
  const now = new Date().toISOString();

  // 전액 취소 판정. 토스는 취소 합계가 결제 금액에 도달하면 상태를 CANCELED 로 바꾸므로
  // 그 하나로 충분하지만, 부분 취소를 반복해 잔액이 0이 된 경우까지 함께 본다.
  //
  // balanceAmount === 0 만으로 판정하면 안 된다 — 아직 승인 전(READY)인 결제도 잔액이
  // 0이라, 결제되지도 않은 건을 "환불됨"으로 처리하게 된다.
  const fullyCanceled =
    payment.status === "CANCELED" ||
    (payment.status === "PARTIAL_CANCELED" && payment.balanceAmount === 0);

  if (payment.status === "DONE") {
    // status 를 paid 로 올린다. 'ready' 뿐 아니라 'failed' 에서도 올라올 수 있게 두는
    // 이유: 실패 콜백이 먼저 도착한 뒤 웹훅이 "승인됨"을 알려주는 순서가 실제로 있다.
    // 돈의 진실은 PG 에 있으므로 우리 쪽 중간 기록이 아니라 PG 상태를 따른다.
    await admin
      .from("payments")
      .update({
        status: "paid",
        payment_key: payment.paymentKey,
        method: payment.method ?? null,
        receipt_url: payment.receipt?.url ?? null,
        paid_at: payment.approvedAt ?? now,
        fail_reason: null,
        raw,
        updated_at: now,
      })
      .eq("order_id", row.order_id)
      .in("status", ["ready", "failed", "paid"]);

    await grantMembershipFor(row);
    return "paid";
  }

  if (fullyCanceled) {
    await admin
      .from("payments")
      .update({ payment_key: payment.paymentKey, raw, updated_at: now })
      .eq("order_id", row.order_id);
    await revokeMembershipFor(row);
    return "canceled";
  }

  if (payment.status === "PARTIAL_CANCELED") {
    // 부분 취소는 "며칠치만 환불"에 해당하는데, 우리 요금제는 기간을 통째로 파는
    // 구조라 자동으로 며칠을 뺄 근거가 없다. 기록만 남기고 사람이 판단하게 둔다
    // (관리자가 남은 기간을 조정한다). 자동으로 전액 회수하면 부분 환불한 사용자의
    // 멤버십이 통째로 끊긴다.
    await admin
      .from("payments")
      .update({
        raw,
        fail_reason: "부분 취소됨 — 남은 기간 수동 확인 필요",
        updated_at: now,
      })
      .eq("order_id", row.order_id);
    return "paid";
  }

  if (payment.status === "ABORTED" || payment.status === "EXPIRED") {
    await markPaymentFailed(row.order_id, `결제가 완료되지 않았어요 (${payment.status})`);
    return "failed";
  }

  // READY / IN_PROGRESS — 아직 결과가 안 나온 상태. 건드리지 않는다.
  return row.status;
}

// 실패 사유는 코드로 돌려준다(사람이 읽을 문구가 아니라). 이 값은 결과 화면 주소의
// 쿼리로 실려 가는데, 거기에 문장을 실으면 누구나 그 주소를 만들어 우리 화면에 원하는
// 문구를 띄울 수 있다("결제가 정상 처리되지 않았습니다. 아래로 연락 주세요" 같은).
// 문구는 화면이 이 코드를 보고 고른다.
export type SettleFailReason =
  | "not_found"
  | "amount_mismatch"
  | "already_canceled"
  | "confirm_failed"
  | "not_completed";

export type SettleResult =
  | { ok: true; status: PaymentStatus }
  | { ok: false; reason: SettleFailReason };

// 승인을 진행할지 말지의 판단. 돈이 걸린 분기라 네트워크·DB 없이 검증할 수 있게
// 순수 함수로 떼어 뒀다(payments.test.ts).
//
// 특히 amount 검증이 여기 있다는 게 중요하다. 리다이렉트 쿼리로 돌아온 금액은
// 사용자가 고칠 수 있는 값이라, 그걸 그대로 승인에 넘기면 5,900원짜리를 100원에
// 팔게 된다. 이 함수는 "우리 DB 의 금액"만 승인 금액으로 내보낸다.
export type SettleDecision =
  | { action: "already_paid"; needsGrant: boolean }
  | { action: "reject"; reason: SettleFailReason }
  | { action: "confirm"; amount: number };

export function decideSettlement(
  row: Pick<PaymentRow, "status" | "amount" | "granted_at">,
  amountFromPg: number,
): SettleDecision {
  // 이미 처리된 주문(웹훅이 먼저 도착했거나 사용자가 새로고침한 경우)은 그대로 성공.
  // 다만 기간 부여가 남아 있을 수 있다 — 승인은 됐는데 부여 단계에서 실패한 경우다.
  if (row.status === "paid") {
    return { action: "already_paid", needsGrant: !row.granted_at };
  }
  if (row.status === "canceled") return { action: "reject", reason: "already_canceled" };

  if (!Number.isFinite(amountFromPg) || amountFromPg !== row.amount) {
    return { action: "reject", reason: "amount_mismatch" };
  }

  // 승인 요청에는 반드시 DB 의 금액을 쓴다(쿼리로 온 값이 아니라).
  return { action: "confirm", amount: row.amount };
}

// 결제창에서 돌아온 사용자를 받아 승인까지 끝낸다(successUrl 경로).
//
// amountFromPg 는 쿼리스트링으로 온 값이라 신뢰하지 않는다 — 우리 DB 의 금액과
// 대조하는 용도로만 쓰고, 실제 승인 요청에는 DB 의 금액을 넣는다.
export async function settleTossPayment(params: {
  orderId: string;
  paymentKey: string;
  amountFromPg: number;
}): Promise<SettleResult> {
  const row = await getPaymentByOrderId(params.orderId);
  if (!row) return { ok: false, reason: "not_found" };

  const decision = decideSettlement(row, params.amountFromPg);

  if (decision.action === "already_paid") {
    // DB 함수가 이미 부여된 건은 'already' 로 넘기므로 두 번 불러도 안전하다.
    if (decision.needsGrant) await grantMembershipFor(row);
    return { ok: true, status: "paid" };
  }

  if (decision.action === "reject") {
    // 금액이 어긋난 주문은 승인을 시도조차 하지 않는다 — 돈이 빠지지 않는다.
    if (decision.reason === "amount_mismatch") {
      await markPaymentFailed(row.order_id, "결제 금액이 주문 금액과 달라 승인하지 않았어요.");
    }
    return { ok: false, reason: decision.reason };
  }

  const result = await confirmTossPayment({
    paymentKey: params.paymentKey,
    orderId: row.order_id,
    amount: decision.amount, // 반드시 DB 의 값
  });

  if (!result.ok) {
    // 네트워크 실패는 "승인이 갔는지 모르는" 상태다. 실패로 확정해 버리면 돈은 빠졌는데
    // 우리는 실패로 기록한 주문이 남는다 — ready 로 두면 웹훅이 진실을 알려준다.
    if (result.code !== "NETWORK_ERROR") {
      await markPaymentFailed(row.order_id, `${result.code}: ${result.message}`);
    }
    return { ok: false, reason: "confirm_failed" };
  }

  const status = await applyTossPaymentState(row, result.payment, result.raw);
  return status === "paid" ? { ok: true, status } : { ok: false, reason: "not_completed" };
}

// 웹훅 경로. 본문은 "무언가 바뀌었다"는 신호로만 쓰고, 실제 상태는 토스에 다시 묻는다.
export async function syncTossPaymentByKey(paymentKey: string): Promise<void> {
  const result = await fetchTossPayment(paymentKey);
  if (!result.ok) return;

  const row = await getPaymentByOrderId(result.payment.orderId);
  if (!row) return;

  // 조회한 결제의 금액이 우리 주문 금액과 다르면 우리 주문이 아니다(또는 위조된
  // paymentKey 다). 남의 결제로 우리 사용자의 기간을 늘리지 않는다.
  if (result.payment.totalAmount !== row.amount) return;

  await applyTossPaymentState(row, result.payment, result.raw);
}

// 내 결제 내역. 결제창만 띄우고 닫은 주문('ready')은 사용자에게 의미 없는 줄이라
// 빼고 보여준다 — 결제를 시도한 흔적이 실패 기록처럼 쌓이면 불안하게 만든다.
export async function listUserPayments(userId: string): Promise<PaymentRow[]> {
  const { data } = await createAdminClient()
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("user_id", userId)
    .neq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(50);
  return (data as PaymentRow[] | null) ?? [];
}
