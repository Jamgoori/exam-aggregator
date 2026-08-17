import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2, CircleAlert, Receipt } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPaymentByOrderId } from "@/lib/payments";
import { findPlan, formatWon } from "@gongmoa/core";

export const metadata: Metadata = {
  title: "결제 결과",
  // 결과 화면은 개인 거래 내역이라 검색에 남으면 안 된다.
  robots: { index: false, follow: false },
};

// 결제창에서 돌아온 사용자가 도착하는 화면. 승인 처리는 /payments/toss/success 라우트가
// 이미 끝냈고, 여기서는 DB 에 적힌 결과를 읽어서 보여주기만 한다 — 그래서 새로고침해도
// 결제가 다시 일어나지 않는다.
//
// 실패 사유는 코드로만 받는다. 쿼리로 받은 문장을 그대로 그리면 누구나 이 주소를 만들어
// 우리 화면에 원하는 문구를 띄울 수 있다("결제 오류. 아래 번호로 연락 주세요" 같은).
const FAIL_MESSAGES: Record<string, { title: string; detail: string }> = {
  user_canceled: {
    title: "결제를 취소했어요",
    detail: "결제된 금액은 없어요. 언제든 다시 시작할 수 있습니다.",
  },
  pg_failed: {
    title: "결제하지 못했어요",
    detail:
      "카드사에서 승인이 거절됐거나 결제가 중단됐어요. 결제된 금액은 없으니 다시 시도하거나 다른 카드를 이용해주세요.",
  },
  not_found: {
    title: "주문을 찾을 수 없어요",
    detail: "결제 정보를 확인하지 못했어요. 결제된 금액이 있다면 문의해주세요.",
  },
  amount_mismatch: {
    title: "결제 금액이 주문과 달라요",
    detail: "안전을 위해 승인하지 않았어요. 결제된 금액은 없습니다. 다시 시도해주세요.",
  },
  already_canceled: {
    title: "이미 취소된 주문이에요",
    detail: "이 주문은 취소 처리됐어요. 새로 결제하시려면 요금제를 다시 선택해주세요.",
  },
  confirm_failed: {
    title: "결제 승인에 실패했어요",
    detail:
      "결제가 완료되지 않았어요. 카드 내역에 승인이 남아 있다면 자동으로 취소되니 잠시 기다려주세요.",
  },
  not_completed: {
    title: "결제가 완료되지 않았어요",
    detail: "결제 상태를 확인하지 못했어요. 잠시 후 결제 내역에서 다시 확인해주세요.",
  },
};

const FALLBACK_FAIL = {
  title: "결제를 마치지 못했어요",
  detail: "결제가 완료되지 않았어요. 다시 시도하거나 문의해주세요.",
};

export default async function PaymentCompletePage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; reason?: string }>;
}) {
  const { order, reason } = await searchParams;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent("/membership")}`);
  }

  // 주문은 본인 것만 보여준다. order 는 주소창에 그대로 노출되는 값이라, 남의 주문번호를
  // 넣어 결제 금액·시각을 들여다볼 수 있으면 안 된다.
  const payment = order ? await getPaymentByOrderId(order) : null;
  const mine = payment && payment.user_id === user.id ? payment : null;

  const succeeded = !reason && mine?.status === "paid";

  if (succeeded) {
    const plan = findPlan(mine.plan_id);
    return (
      <Shell>
        <div className="flex flex-col items-center gap-3 text-center">
          <CheckCircle2 size={44} className="text-emerald-500" aria-hidden />
          <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">
            멤버십이 시작됐어요
          </h1>
          <p className="break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            오답노트·복습과 무제한 해설이 지금 바로 열렸어요.
          </p>
        </div>

        <dl className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-700">
          <Row label="요금제" value={plan ? plan.label : mine.plan_id} />
          <Row label="결제 금액" value={formatWon(mine.amount)} />
          {mine.method && <Row label="결제 수단" value={mine.method} />}
          <Row label="주문번호" value={mine.order_id} mono />
        </dl>

        <div className="flex flex-col gap-2">
          <Link
            href="/mypage"
            className="w-full rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-blue-700"
          >
            오답노트 보러 가기
          </Link>
          {mine.receipt_url && (
            <a
              href={mine.receipt_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 rounded-xl border border-zinc-200 px-5 py-2.5 text-sm font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:text-blue-400"
            >
              <Receipt size={15} aria-hidden />
              영수증 보기
            </a>
          )}
        </div>
      </Shell>
    );
  }

  const fail = (reason && FAIL_MESSAGES[reason]) || FALLBACK_FAIL;
  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 text-center">
        <CircleAlert size={44} className="text-amber-500" aria-hidden />
        <h1 className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">
          {fail.title}
        </h1>
        <p className="break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          {fail.detail}
        </p>
      </div>

      {mine && (
        <dl className="flex flex-col gap-2 rounded-2xl border border-zinc-200 p-4 text-sm dark:border-zinc-700">
          <Row label="주문번호" value={mine.order_id} mono />
        </dl>
      )}

      <div className="flex flex-col gap-2">
        <Link
          href="/membership"
          className="w-full rounded-xl bg-blue-600 px-5 py-3 text-center text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          요금제 다시 보기
        </Link>
        <a
          href="mailto:lks2354@gmail.com"
          className="rounded-xl border border-zinc-200 px-5 py-2.5 text-center text-sm font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800 dark:hover:text-blue-400"
        >
          문의하기
        </a>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6 px-4 pb-16 pt-10 sm:pt-16">
      {children}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-zinc-500 dark:text-zinc-500">{label}</dt>
      <dd
        className={`break-all text-right font-medium text-zinc-900 dark:text-zinc-100 ${
          mono ? "font-mono text-xs" : ""
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
