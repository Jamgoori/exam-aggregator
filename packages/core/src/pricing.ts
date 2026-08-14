// 멤버십 요금제 정의 — 웹·모바일 공유(순수 계산).
//
// 가격은 여기 하나가 정본이다. 결제 페이지·앱 스토어 안내·유도 문구가 각자 숫자를
// 들고 있으면 인상/할인 때 한 곳이 남아 다른 값을 광고하게 된다.
//
// 표시 규칙 두 가지는 "절대 유리하게 반올림하지 않는다"로 통일했다. 할인율은
// 표시광고 문제가 되기 쉬운 숫자라, 실제보다 크게 보이는 방향(반올림 올림)을
// 쓰지 않는다.
//   - 월 환산가: 올림 (14,900/3 = 4,966.67 → 4,967원). 내림이면 실제 부담보다
//     싸 보인다.
//   - 할인율:   내림 (2,800/17,700 = 15.8% → 15%). 반올림이면 실제보다 크게 보인다.

export type PlanId = "monthly" | "quarterly" | "yearly";

export type MembershipPlan = {
  id: PlanId;
  // 화면에 그대로 쓰는 이름.
  label: string;
  months: number;
  // 1회 결제 금액(원, 부가세 포함).
  price: number;
};

// 1개월권이 할인율의 기준선이다 — 아래 순서가 화면 노출 순서이기도 하다.
export const MEMBERSHIP_PLANS: MembershipPlan[] = [
  { id: "monthly", label: "1개월", months: 1, price: 5900 },
  { id: "quarterly", label: "3개월", months: 3, price: 14900 },
  { id: "yearly", label: "1년", months: 12, price: 39900 },
];

export const BASE_MONTHLY_PRICE = 5900;

// 기본으로 고르게 할 플랜. 할인 폭이 가장 큰 1년권을 권장으로 둔다.
export const RECOMMENDED_PLAN_ID: PlanId = "yearly";

export type PlanPricing = {
  plan: MembershipPlan;
  // 월 환산 금액(올림).
  monthlyPrice: number;
  // 1개월권을 months번 결제했을 때의 금액 — 할인율의 분모.
  baselinePrice: number;
  // 아낀 금액(원). 1개월권은 0.
  savedAmount: number;
  // 할인율(%, 내림). 1개월권은 0.
  discountPercent: number;
};

export function planPricing(plan: MembershipPlan): PlanPricing {
  const baselinePrice = BASE_MONTHLY_PRICE * plan.months;
  const savedAmount = Math.max(0, baselinePrice - plan.price);
  return {
    plan,
    monthlyPrice: Math.ceil(plan.price / plan.months),
    baselinePrice,
    savedAmount,
    // 분모가 0일 수는 없지만(months >= 1), 방어적으로 나눗셈을 감싼다.
    discountPercent:
      baselinePrice > 0 ? Math.floor((savedAmount / baselinePrice) * 100) : 0,
  };
}

export function allPlanPricing(): PlanPricing[] {
  return MEMBERSHIP_PLANS.map(planPricing);
}

export function findPlan(id: string | null | undefined): MembershipPlan | null {
  return MEMBERSHIP_PLANS.find((p) => p.id === id) ?? null;
}

// "5,900원" — 통화 기호 없이 원 단위로만. 앱·웹이 같은 표기를 쓰게 한다.
export function formatWon(amount: number): string {
  return `${amount.toLocaleString("ko-KR")}원`;
}
