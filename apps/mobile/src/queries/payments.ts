import type { PaymentStatus } from "@gongmoa/core";
import { useQuery } from "@tanstack/react-query";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 내 결제 내역(`/mypage/payments`) — 웹 lib/payments.ts listUserPayments 와 같은 조회.
//
// 웹은 service_role(admin 클라이언트)로 읽지만 앱은 RLS 로 본인 행만 읽는다
// (schema.sql "select own payments": `for select to authenticated using (auth.uid() = user_id)`).
// 결과는 같다 — 정책이 user_id 로 이미 거르므로 웹의 `.eq("user_id", …)` 와 같은 집합이다.
// 그래도 eq 를 함께 건다(정책이 바뀌어도 화면이 남의 행을 그리지 않게).
//
// `ready` 제외는 웹과 같은 이유다: 결제창만 띄우고 닫은 주문은 사용자에게 의미 없는 줄이고,
// 시도한 흔적이 실패 기록처럼 쌓이면 불안하게 만든다.
//
// **디스크에 남기지 않는다**(meta.persist:false — AGENTS.md 금지선 / 설계서 §6.5 (4)
// "멤버십 행·결제 raw"). 앱을 껐다 켜면 사라지고 다시 읽는다. `raw`(PG 응답 원본) 컬럼은
// 애초에 고르지 않는다 — 웹 PAYMENT_COLUMNS 도 같다.

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

// 웹 lib/payments.ts PAYMENT_COLUMNS 와 같은 목록.
const PAYMENT_COLUMNS =
  "order_id, user_id, plan_id, months, amount, status, payment_key, method, receipt_url, paid_at, granted_at, canceled_at, fail_reason, created_at";

export const paymentsKey = (userId: string) => ["me", userId, "payments"] as const;

async function fetchMyPayments(userId: string): Promise<PaymentRow[]> {
  const { data, error } = await supabase
    .from("payments")
    .select(PAYMENT_COLUMNS)
    .eq("user_id", userId)
    .neq("status", "ready")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(`결제 내역 조회 실패: ${error.message}`);
  return (data ?? []) as unknown as PaymentRow[];
}

export function useMyPayments() {
  const { userId } = useAuth();
  return useQuery<PaymentRow[]>({
    queryKey: paymentsKey(userId ?? ""),
    queryFn: () => fetchMyPayments(userId!),
    enabled: !!userId,
    staleTime: STALE.me,
    meta: { persist: false },
  });
}
