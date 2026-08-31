"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Info, Loader2 } from "lucide-react";
import {
  allPlanPricing,
  formatWon,
  RECOMMENDED_PLAN_ID,
  type PlanId,
} from "@gongmoa/core";
import { startMembershipCheckout } from "@/app/membership/actions";
import { isUserCanceled, loadTossPayments } from "@/lib/toss-browser";
import { clarityEvent, clarityTag, clarityUpgrade } from "@/lib/clarity";

// 요금제 선택 + 결제 버튼. 가격·할인율은 전부 @gongmoa/core 의 요금제 정의에서
// 계산해 온다 — 이 파일에 숫자를 적지 말 것.
//
// paymentEnabled 가 false 면(= PG 키 미설정) 예전처럼 "준비 중"을 정직하게 말한다.
// 결제창이 뜰 것처럼 만들어 두고 아무 일도 일어나지 않으면, 결제가 실패한 줄 알고
// 카드를 다시 확인하는 사람이 생긴다.
//
// 결제 수단은 지금 카드(간편결제 포함 카드창)만 연다. 카카오페이·네이버페이를 따로
// 고르게 하려면 토스 "결제위젯"으로 바꿔야 하는데, 그건 결제 수단 UI 를 페이지에
// 직접 렌더링하는 방식이라 이 카드 레이아웃과 별개 화면이 필요하다.

const PLANS = allPlanPricing();

export function MembershipPlans({
  alreadyPremium,
  paymentEnabled,
}: {
  alreadyPremium: boolean;
  paymentEnabled: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<PlanId>(RECOMMENDED_PLAN_ID);
  const [notice, setNotice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const current = PLANS.find((p) => p.plan.id === selected)!;

  async function startCheckout() {
    // 이중 클릭 방지가 계측보다 먼저 와야 한다 — 뒤에 두면 한 번의 결제 시도가
    // checkout_start 두 건으로 세어져 퍼널 수치가 부풀려진다.
    if (pending) return;

    // Clarity 계측. 결제는 드물게 일어나므로 표본 녹화에서 빠지기 쉬운데, 정작
    // 리플레이를 봐야 하는 건 이 세션들이다. 그래서 이벤트를 남기고 세션을 올린다.
    clarityTag("plan", selected);
    clarityEvent("checkout_start");
    clarityUpgrade("checkout_start");

    if (!paymentEnabled) {
      // "준비 중" 안내를 본 사람은 결제하려다 못 한 사람이다 — 전환 퍼널에서
      // 결제창을 열어본 사람과 절대 섞으면 안 된다.
      clarityEvent("checkout_unavailable");
      setNotice(true);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await startMembershipCheckout(selected);
      if (!result.ok) {
        if (result.needsLogin) {
          clarityEvent("checkout_needs_login");
          router.push(`/login?next=${encodeURIComponent("/membership")}`);
          return;
        }
        clarityEvent("checkout_error");
        setError(result.error);
        return;
      }

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
          card: { useEscrow: false, flowMode: "DEFAULT" },
        });
      // 여기까지 오면 결제창이 리다이렉트를 맡는다(성공/실패 주소로 브라우저가 이동).
      clarityEvent("checkout_widget_opened");
    } catch (e) {
      // 사용자가 스스로 창을 닫은 것은 오류가 아니다 — 아무 말도 하지 않는 게 맞다.
      // 다만 분석에서는 "직접 취소"와 "창이 안 열림"을 반드시 갈라야 한다. 둘을 한
      // 덩어리로 세면 결제 실패율이 실제보다 훨씬 나빠 보인다.
      if (isUserCanceled(e)) {
        clarityEvent("checkout_canceled");
      } else {
        clarityEvent("checkout_open_failed");
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
