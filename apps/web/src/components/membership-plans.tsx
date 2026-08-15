"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, CreditCard, Info, Loader2 } from "lucide-react";
import {
  allPlanPricing,
  formatWon,
  RECOMMENDED_PLAN_ID,
  type PlanId,
} from "@gongmoa/core";
import { startMembershipCheckout } from "@/app/membership/actions";
import { isUserCanceled, loadTossPayments } from "@/lib/toss-browser";
import { EASY_PAY_LABELS, type EasyPayCode } from "@/lib/easy-pay";

// 요금제 선택 + 결제수단 선택 + 결제 버튼. 가격·할인율은 전부 @gongmoa/core 의 요금제
// 정의에서 계산해 온다 — 이 파일에 숫자를 적지 말 것.
//
// paymentEnabled 가 false 면(= PG 키 미설정) 예전처럼 "준비 중"을 정직하게 말한다.
// 결제창이 뜰 것처럼 만들어 두고 아무 일도 일어나지 않으면, 결제가 실패한 줄 알고
// 카드를 다시 확인하는 사람이 생긴다.
//
// 결제수단 줄은 easyPayMethods 가 비어 있지 않을 때만 그린다. 간편결제는 코드가 아니라
// 계약이라(토스 상점관리자에서 수단별 심사) 계약이 끝난 것만 서버가 내려보낸다 —
// lib/easy-pay.ts 참고. 목록이 비면 카드 하나뿐이라 고를 게 없으므로 줄 자체를 숨긴다:
// 선택지가 하나인 선택 UI 는 결제 단계를 한 칸 늘리기만 한다.

// 결제수단 버튼의 브랜드 색. 로고 이미지를 쓰지 않고 색과 이름만 빌린다 — 각 사의
// 로고는 사용 규정이 따로 있고, 이미지 한 장 때문에 결제 화면 로딩이 늦어질 이유도 없다.
const EASY_PAY_BRAND: Record<EasyPayCode, { mark: string; className: string }> = {
  KAKAOPAY: { mark: "k", className: "bg-[#FFEB00] text-[#3B1E1E]" },
  NAVERPAY: { mark: "N", className: "bg-[#03C75A] text-white" },
  TOSSPAY: { mark: "t", className: "bg-[#0064FF] text-white" },
  PAYCO: { mark: "P", className: "bg-[#FF2828] text-white" },
};

// 화면에서 고른 결제수단. "CARD" 는 카드/간편결제 통합결제창(토스 창 안에서 고르는 쪽),
// 나머지는 해당 간편결제 앱을 곧장 여는 자체창이다.
type PayMethod = "CARD" | EasyPayCode;

const PLANS = allPlanPricing();

export function MembershipPlans({
  alreadyPremium,
  paymentEnabled,
  easyPayMethods,
}: {
  alreadyPremium: boolean;
  paymentEnabled: boolean;
  easyPayMethods: EasyPayCode[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PlanId>(RECOMMENDED_PLAN_ID);
  const [payMethod, setPayMethod] = useState<PayMethod>("CARD");
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = PLANS.find((p) => p.plan.id === selected)!;

  async function startCheckout() {
    if (!paymentEnabled) {
      setNotice(true);
      return;
    }
    // 이중 클릭 방지. 막지 않으면 주문이 두 건 만들어지고, 사용자는 자기가 뭘 결제한
    // 건지 모르는 채 결제창을 두 번 보게 된다.
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const result = await startMembershipCheckout(selected);
      if (!result.ok) {
        if (result.needsLogin) {
          router.push(`/login?next=${encodeURIComponent("/membership")}`);
          return;
        }
        setError(result.error);
        return;
      }

      // 간편결제도 method 는 CARD 다 — 카드와 간편결제가 같은 결제창 계열이고,
      // 어느 쪽을 여는지는 flowMode 로 갈린다.
      const easyPay = payMethod === "CARD" ? undefined : payMethod;

      const TossPayments = await loadTossPayments();
      await TossPayments(result.clientKey)
        .payment({ customerKey: result.customerKey })
        .requestPayment({
          method: "CARD",
          amount: { currency: "KRW", value: result.amount },
          orderId: result.orderId,
          orderName: result.orderName,
          successUrl: result.successUrl,
          failUrl: result.failUrl,
          card: easyPay
            ? { useEscrow: false, flowMode: "DIRECT", easyPay }
            : { useEscrow: false, flowMode: "DEFAULT" },
        });
      // 여기까지 오면 결제창이 리다이렉트를 맡는다(성공/실패 주소로 브라우저가 이동).
    } catch (e) {
      // 사용자가 스스로 창을 닫은 것은 오류가 아니다 — 아무 말도 하지 않는 게 맞다.
      if (!isUserCanceled(e)) {
        setError("결제창을 열지 못했어요. 잠시 후 다시 시도해주세요.");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* 카드 세 장. 좁은 화면에서는 세로로 쌓되 순서는 그대로 둔다 — 1개월이 맨 위에
          있어야 "기준가 대비 얼마나 싼가"가 읽힌다. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PLANS.map(({ plan, monthlyPrice, baselinePrice, savedAmount, discountPercent }) => {
          const isSelected = plan.id === selected;
          const isRecommended = plan.id === RECOMMENDED_PLAN_ID;
          return (
            <button
              key={plan.id}
              type="button"
              onClick={() => setSelected(plan.id)}
              aria-pressed={isSelected}
              className={`relative flex flex-col gap-2 rounded-2xl border-2 p-4 text-left transition-colors ${
                isSelected
                  ? "border-blue-600 bg-blue-50/60 dark:border-blue-500 dark:bg-blue-950/30"
                  : "border-zinc-200 hover:border-blue-300 dark:border-zinc-700 dark:hover:border-blue-800"
              }`}
            >
              {isRecommended && (
                <span className="absolute -top-2.5 left-4 rounded-full bg-blue-600 px-2 py-0.5 text-[11px] font-bold text-white">
                  가장 저렴해요
                </span>
              )}

              <div className="flex items-center justify-between gap-2">
                <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">
                  {plan.label}
                </span>
                {discountPercent > 0 && (
                  <span className="shrink-0 rounded-full bg-red-500 px-2 py-0.5 text-xs font-extrabold text-white">
                    {discountPercent}% 할인
                  </span>
                )}
              </div>

              {/* 실제로 결제할 금액(총액)을 가장 크게 둔다. 월 환산가를 크게 두면
                  결제 버튼에 찍히는 숫자와 카드에서 본 숫자가 달라 놀라게 된다.
                  월 환산가는 바로 아래에서 요금제끼리 비교할 수 있게 받쳐 준다. */}
              <div className="flex items-baseline gap-1">
                <span className="text-2xl font-extrabold text-zinc-900 dark:text-zinc-100">
                  {plan.price.toLocaleString("ko-KR")}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-500">원</span>
              </div>

              <div className="flex flex-col gap-0.5 text-xs">
                <span className="font-bold text-zinc-700 dark:text-zinc-300">
                  월 {formatWon(monthlyPrice)} 꼴
                </span>
                {savedAmount > 0 ? (
                  <span className="text-zinc-500 dark:text-zinc-500">
                    <span className="mr-1 text-zinc-400 line-through dark:text-zinc-600">
                      {formatWon(baselinePrice)}
                    </span>
                    <span className="font-bold text-red-600 dark:text-red-400">
                      {formatWon(savedAmount)} 아껴요
                    </span>
                  </span>
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600">기준 요금</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* 결제수단. 계약된 간편결제가 있을 때만 나타난다.
          가로 스크롤 대신 격자로 접는다 — 스크롤을 두면 좁은 화면에서 오른쪽 수단이
          화면 밖에 숨어, 카카오페이가 있는 줄 모르고 카드로 결제하게 된다.
          좁은 화면 2열 / sm 이상 3열이라 칸 너비가 서로 같다(줄바꿈이 들쭉날쭉하면
          마지막 수단만 급조해 붙인 것처럼 보인다). */}
      {paymentEnabled && easyPayMethods.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-sm font-bold text-zinc-700 dark:text-zinc-300">결제수단</span>
          <div
            className="grid grid-cols-2 gap-2 sm:grid-cols-3"
            role="group"
            aria-label="결제수단"
          >
            {/* 카드는 좁은 화면에서 한 줄을 다 쓴다. 이름이 가장 길어서 반 칸에 넣으면
                "신용·체크카 / 드"로 접히고(320px 실측), 간편결제 두 개가 아래 줄에
                나란히 서는 모양이 오히려 읽기 좋다. */}
            <MethodButton
              selected={payMethod === "CARD"}
              onSelect={() => setPayMethod("CARD")}
              label="신용·체크카드"
              className="col-span-2 sm:col-span-1"
            />
            {easyPayMethods.map((code) => (
              <MethodButton
                key={code}
                selected={payMethod === code}
                onSelect={() => setPayMethod(code)}
                label={EASY_PAY_LABELS[code]}
                brand={EASY_PAY_BRAND[code]}
              />
            ))}
          </div>
        </div>
      )}

      {/* 선택 요약 + 결제 버튼 */}
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm text-zinc-600 dark:text-zinc-400">
            선택한 요금제{" "}
            <span className="font-bold text-zinc-900 dark:text-zinc-100">
              {current.plan.label}
            </span>
          </span>
          <span className="text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
            {formatWon(current.plan.price)}
            {current.discountPercent > 0 && (
              <span className="ml-2 text-sm font-bold text-red-600 dark:text-red-400">
                {current.discountPercent}% 할인 적용
              </span>
            )}
          </span>
        </div>

        <button
          type="button"
          onClick={startCheckout}
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-blue-400 dark:disabled:bg-blue-900"
        >
          {pending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {pending
            ? "결제창을 여는 중…"
            : payMethod !== "CARD"
              ? // 고른 수단을 버튼에도 적는다. 결제수단 줄에서 카카오페이를 골라 놓고
                // 버튼에는 "멤버십 시작하기"만 적혀 있으면, 선택이 반영됐는지 알 수 없다.
                `${EASY_PAY_LABELS[payMethod]}로 결제하기`
              : alreadyPremium
                ? "멤버십 연장하기"
                : "멤버십 시작하기"}
        </button>

        {error && (
          <p
            role="alert"
            className="rounded-xl bg-red-50 px-3 py-2.5 text-xs leading-5 text-red-700 dark:bg-red-950/30 dark:text-red-300"
          >
            {error}
          </p>
        )}

        {notice && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs leading-5 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
            <Info size={15} className="mt-0.5 shrink-0" />
            <span>
              결제 기능은 아직 준비 중이에요. 요금제와 가격은 위 내용대로 확정됐고,
              결제가 열리면 서비스 안에서 안내해 드릴게요. 문의는{" "}
              <a
                href="mailto:lks2354@gmail.com"
                className="font-bold underline underline-offset-2"
              >
                lks2354@gmail.com
              </a>{" "}
              으로 주세요.
            </span>
          </div>
        )}

        <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
          <Check size={13} className="shrink-0 text-emerald-500" />
          모든 금액은 부가세가 포함된 1회 결제 금액이에요.
        </p>
      </div>
    </div>
  );
}

// 결제수단 버튼 한 개. 선택 표시는 요금제 카드와 같은 방식(파란 테두리 + aria-pressed)을
// 쓴다 — 한 화면에서 고르는 방식이 두 가지면 어느 쪽이 눌린 상태인지 읽기 어려워진다.
function MethodButton({
  selected,
  onSelect,
  label,
  brand,
  className = "",
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  brand?: { mark: string; className: string };
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-2.5 text-sm font-bold transition-colors ${className} ${
        selected
          ? "border-blue-600 bg-blue-50/60 text-zinc-900 dark:border-blue-500 dark:bg-blue-950/30 dark:text-zinc-100"
          : "border-zinc-200 text-zinc-600 hover:border-blue-300 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-800"
      }`}
    >
      {brand ? (
        // 브랜드 표식. aria-hidden 이라 읽어주는 건 옆의 이름뿐이다 — 스크린리더에
        // "k 카카오페이"로 들리면 안 된다.
        <span
          aria-hidden
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md text-xs font-extrabold ${brand.className}`}
        >
          {brand.mark}
        </span>
      ) : (
        <CreditCard size={17} className="shrink-0 text-zinc-400 dark:text-zinc-500" aria-hidden />
      )}
      {label}
    </button>
  );
}
