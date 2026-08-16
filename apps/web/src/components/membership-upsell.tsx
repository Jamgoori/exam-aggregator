import Link from "next/link";
import { allPlanPricing, formatWon } from "@gongmoa/core";

// 무료 회원이 유료 기능 자리에서 보게 되는 안내 카드. 사이트 곳곳(해설 한도, 오답노트,
// 복습, 진단)에서 같은 모양으로 나오도록 한 곳에 둔다 — 화면마다 다른 문구·다른 가격이
// 적히면 어디가 정본인지 알 수 없게 된다.
//
// 가격 문구는 @gongmoa/core 의 요금제 정의에서 계산해 쓴다. 여기에 숫자를 직접 적지 말 것.

// 가장 싼 월 환산가와 그때의 할인율. 유도 문구는 항상 "제일 좋은 조건"을 보여준다.
function bestOffer() {
  const best = allPlanPricing().reduce((a, b) => (b.monthlyPrice < a.monthlyPrice ? b : a));
  return { monthlyPrice: best.monthlyPrice, discountPercent: best.discountPercent };
}

export function MembershipUpsell({
  title,
  description,
  // 결제 페이지에서 돌아올 곳. 로그인 유도와 같은 방식으로 next 쿼리에 싣는다.
  next,
  className = "",
}: {
  title: string;
  description: string;
  next?: string;
  className?: string;
}) {
  const { monthlyPrice, discountPercent } = bestOffer();
  const href = next ? `/membership?next=${encodeURIComponent(next)}` : "/membership";

  return (
    <div
      className={`flex flex-col items-center gap-3 rounded-2xl border border-blue-200 bg-gradient-to-b from-blue-50 to-white px-6 py-10 text-center dark:border-blue-900/60 dark:from-blue-950/40 dark:to-zinc-900 ${className}`}
    >
      <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{title}</p>
      <p className="max-w-md break-keep text-sm text-zinc-600 dark:text-zinc-400">
        {description}
      </p>
      <Link
        href={href}
        className="mt-1 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
      >
        멤버십 보러 가기
      </Link>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        월 {formatWon(monthlyPrice)}부터
        {discountPercent > 0 && (
          <>
            {" · "}
            <span className="font-bold text-blue-600 dark:text-blue-400">
              1년 결제 시 {discountPercent}% 할인
            </span>
          </>
        )}
      </p>
    </div>
  );
}

// 화면 하나가 통째로 멤버십 전용일 때(복습 세션, AI 약점 진단 등).
// 404로 돌려보내지 않는 이유: 주소는 유효하고 데이터도 남아 있다 — 지금 못 볼 뿐이다.
//
// 오답노트 화면들은 여기 해당하지 않는다 — 열람 자체는 무료고, 해설만 문항별
// 잠금 카드(explanation-lock.tsx)로 가린다.
export function MembershipLockedPage({
  title,
  description,
  backHref,
  backLabel,
  next,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
  next: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-6 sm:pt-8">
      <Link
        href={backHref}
        className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
      >
        ← {backLabel}
      </Link>
      <MembershipUpsell title={title} description={description} next={next} />
    </div>
  );
}
