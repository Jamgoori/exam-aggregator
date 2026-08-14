import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { listUserPayments, type PaymentRow } from "@/lib/payments";
import { findPlan, formatWon } from "@gongmoa/core";

export const metadata: Metadata = {
  title: "결제 내역",
  // 개인 거래 내역이라 검색에 남으면 안 된다.
  robots: { index: false, follow: false },
};

// 내 결제 내역. 전자상거래법상 거래 기록은 보존해야 하고, 무엇보다 결제한 사람이
// "내가 언제 얼마를 냈는지"를 직접 확인할 수 있어야 문의가 줄어든다.
export default async function PaymentsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent("/mypage/payments")}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const payments = await listUserPayments(user.id);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-6 px-4 pb-16 pt-6 sm:pt-8">
      <div>
        <Link
          href="/mypage"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 마이페이지
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">결제 내역</h1>
      </div>

      {payments.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-zinc-200 px-6 py-12 text-center dark:border-zinc-700">
          <Receipt size={28} className="text-zinc-300 dark:text-zinc-600" aria-hidden />
          <p className="text-sm text-zinc-500 dark:text-zinc-500">아직 결제 내역이 없어요.</p>
          <Link
            href="/membership"
            className="mt-1 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            요금제 보기
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {payments.map((payment) => (
            <PaymentItem key={payment.order_id} payment={payment} />
          ))}
        </ul>
      )}

      <p className="break-keep text-xs leading-5 text-zinc-400 dark:text-zinc-600">
        환불을 원하시면{" "}
        <a
          href="mailto:lks2354@gmail.com"
          className="underline underline-offset-2 hover:text-zinc-600"
        >
          lks2354@gmail.com
        </a>
        으로 주문번호와 함께 알려주세요. 환불 기준은{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-zinc-600">
          이용약관
        </Link>
        에 있어요.
      </p>
    </div>
  );
}

// 상태 표시. 사용자에게는 "결제 완료 / 환불됨 / 결제 실패" 세 가지면 충분하다 —
// 내부 상태값(ready 등)을 그대로 보여줄 이유가 없다.
const STATUS_LABEL: Record<string, { text: string; className: string }> = {
  paid: {
    text: "결제 완료",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300",
  },
  canceled: {
    text: "환불됨",
    className: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  },
  failed: {
    text: "결제 실패",
    className: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  },
};

function PaymentItem({ payment }: { payment: PaymentRow }) {
  const plan = findPlan(payment.plan_id);
  const status = STATUS_LABEL[payment.status] ?? STATUS_LABEL.failed;
  // 결제 시각이 없으면(실패) 주문을 만든 시각을 쓴다.
  const at = payment.paid_at ?? payment.created_at;

  return (
    <li className="flex flex-col gap-1.5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
            멤버십 {plan ? plan.label : payment.plan_id}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${status.className}`}
          >
            {status.text}
          </span>
        </span>
        <span
          className={`text-sm font-bold ${
            payment.status === "paid"
              ? "text-zinc-900 dark:text-zinc-100"
              : "text-zinc-400 line-through dark:text-zinc-600"
          }`}
        >
          {formatWon(payment.amount)}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-500 dark:text-zinc-500">
        <span>{formatDateTime(at)}</span>
        {payment.method && <span>· {payment.method}</span>}
        {payment.receipt_url && payment.status === "paid" && (
          <>
            <span>·</span>
            <a
              href={payment.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-blue-600 dark:hover:text-blue-400"
            >
              영수증
            </a>
          </>
        )}
      </div>

      <span className="font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
        {payment.order_id}
      </span>
    </li>
  );
}

// 한국 시간 기준 "2026. 8. 14. 20:31". 서버·클라이언트 어디서 렌더되든 같은 값이
// 나오도록 타임존을 명시한다(안 하면 서버는 UTC, 브라우저는 KST 로 그려 hydration
// 경고가 난다).
function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
