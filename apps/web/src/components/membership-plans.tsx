"use client";

import { useState } from "react";
import { Check, Info } from "lucide-react";
import {
  allPlanPricing,
  formatWon,
  RECOMMENDED_PLAN_ID,
  type PlanId,
} from "@gongmoa/core";

// 요금제 선택 + 결제 버튼. 가격·할인율은 전부 @gongmoa/core 의 요금제 정의에서
// 계산해 온다 — 이 파일에 숫자를 적지 말 것.
//
// 결제 수단(PG) 연동 전이라 버튼은 "준비 중"을 정직하게 말한다. 결제창이 뜰 것처럼
// 만들어 두고 아무 일도 일어나지 않으면, 결제가 실패한 줄 알고 카드를 다시 확인하는
// 사람이 생긴다. 연동할 때 이 컴포넌트의 startCheckout 안만 바꾸면 된다.

const PLANS = allPlanPricing();

export function MembershipPlans({ alreadyPremium }: { alreadyPremium: boolean }) {
  const [selected, setSelected] = useState<PlanId>(RECOMMENDED_PLAN_ID);
  const [notice, setNotice] = useState(false);
  const current = PLANS.find((p) => p.plan.id === selected)!;

  function startCheckout() {
    // TODO: PG 연동 시 여기서 결제창을 띄운다(선택한 plan.id 를 그대로 넘기면 된다).
    setNotice(true);
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
          className="w-full rounded-xl bg-blue-600 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-blue-700"
        >
          {alreadyPremium ? "멤버십 연장하기" : "멤버십 시작하기"}
        </button>

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
