import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMembership, isAdminUser } from "@/lib/membership";
import { MembershipPlans } from "@/components/membership-plans";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import {
  FREE_EXPLANATION_DAILY_PAPERS,
  TRIAL_DAYS,
  allPlanPricing,
  formatWon,
  isPremiumMembership,
  trialDaysLeft,
} from "@gongmoa/core";

export const metadata: Metadata = {
  title: "멤버십 요금제",
  description: `공모아 멤버십 요금제 안내. 오답노트·복습·AI 약점 진단·무제한 해설을 월 ${allPlanPricing()[2].monthlyPrice.toLocaleString("ko-KR")}원부터 이용하세요.`,
  alternates: { canonical: "/membership" },
};

// 결제(요금제) 페이지. 로그인 없이도 볼 수 있어야 한다 — 가격을 보려고 가입부터
// 해야 하면 대부분 그냥 나간다. 로그인한 사람에게만 현재 상태 줄이 하나 더 붙는다.
//
// 가격·할인율은 전부 @gongmoa/core 의 요금제 정의(pricing.ts)에서 온다. 이 파일이나
// 유도 배너에 숫자를 직접 적지 말 것 — 인상·할인 때 한 곳이 남아 다른 값을 광고하게 된다.
export default async function MembershipPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // 유도 배너가 실어 보낸 "원래 보던 곳". 외부 주소로 튕기지 않게 검증하고,
  // next 가 없어서 홈("/")으로 떨어진 경우에는 되돌아가기 줄을 아예 그리지 않는다
  // (직접 들어온 사람에게 "보던 화면으로"는 말이 안 된다).
  const backHref = next ? sanitizeNextPath(next) : null;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [membership, admin] = user
    ? await Promise.all([getMembership(supabase, user.id), isAdminUser(supabase)])
    : [null, false];
  const premium = admin || isPremiumMembership(membership);
  const daysLeft = admin ? null : trialDaysLeft(membership);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pb-16 pt-6 sm:pt-10">
      {backHref && (
        <Link
          href={backHref}
          className="-mb-6 text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 보던 화면으로
        </Link>
      )}

      {/* 헤드라인 */}
      <header className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-600 text-white">
          <Sparkles size={24} />
        </span>
        <h1 className="break-keep text-3xl font-extrabold text-zinc-900 dark:text-zinc-100">
          틀린 문제를 끝까지 <span className="text-blue-600 dark:text-blue-400">붙잡아 주는</span>{" "}
          멤버십
        </h1>
        <p className="max-w-lg break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          기출을 푸는 건 무료입니다. 멤버십은 그다음 &mdash; 틀린 문제를 과목별로 모으고,
          언제 다시 볼지 문항마다 계산해 그날 볼 것만 내주고, 어떤 개념이 약한지
          짚어주는 기능이에요.
        </p>
        <CurrentStatus premium={premium} admin={admin} daysLeft={daysLeft} loggedIn={!!user} />
      </header>

      {/* 요금제 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>요금제</SectionTitle>
        <MembershipPlans alreadyPremium={premium} />
      </section>

      {/* 무료 vs 멤버십 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>무료와 뭐가 다른가요</SectionTitle>
        <FeatureTable />
      </section>

      {/* 체험 안내 */}
      <section className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <p className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
          처음 오신 분께는 {TRIAL_DAYS}일 무료 체험이 있어요
        </p>
        <p className="break-keep text-sm leading-6 text-emerald-800/90 dark:text-emerald-300/80">
          체험은 가입한 날이 아니라 <b>CBT로 문제를 처음 채점한 날</b>부터 시작해요.
          가입 직후엔 틀린 문제가 없어 복습할 거리도 없는데, 그 기간을 체험으로 세면
          정작 써볼 게 없는 채로 며칠이 지나가거든요. 카드 정보는 받지 않고, 체험이
          끝나도 자동으로 결제되지 않아요.
        </p>
      </section>

      {/* 자주 묻는 질문 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>자주 묻는 질문</SectionTitle>
        <Faq />
      </section>

      <p className="text-center text-xs leading-5 text-zinc-400 dark:text-zinc-600">
        표시된 금액은 부가세 포함 금액입니다. 결제·환불 조건은{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-zinc-600">
          이용약관
        </Link>
        을 따릅니다.
      </p>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{children}</h2>
  );
}

// 로그인한 사람에게 지금 자기 상태를 한 줄로. 이게 없으면 이미 결제한 사람이
// 결제 페이지에서 자기가 회원인지 아닌지 알 수 없다.
function CurrentStatus({
  premium,
  admin,
  daysLeft,
  loggedIn,
}: {
  premium: boolean;
  admin: boolean;
  daysLeft: number | null;
  loggedIn: boolean;
}) {
  if (!loggedIn) {
    return (
      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        <Link
          href="/login?next=%2Fmembership"
          className="font-medium text-blue-600 hover:underline dark:text-blue-400"
        >
          로그인
        </Link>
        하면 지금 내 멤버십 상태를 볼 수 있어요.
      </p>
    );
  }

  // 관리자는 멤버십과 무관하게 유료 기능을 쓴다 — "체험 N일 남음"을 보여주면 거짓말이 된다.
  if (admin) {
    return <StatusPill tone="blue">관리자 계정 · 모든 기능 이용 중</StatusPill>;
  }
  if (premium && daysLeft != null) {
    return <StatusPill tone="blue">무료 체험 중 · {daysLeft}일 남음</StatusPill>;
  }
  if (premium) {
    return <StatusPill tone="blue">멤버십 이용 중</StatusPill>;
  }
  return <StatusPill tone="zinc">현재 무료 회원</StatusPill>;
}

function StatusPill({
  tone,
  children,
}: {
  tone: "blue" | "zinc";
  children: React.ReactNode;
}) {
  const cls =
    tone === "blue"
      ? "bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{children}</span>
  );
}

// 무료/멤버십 비교. 여기 적힌 것이 실제 동작과 어긋나면 그 자체로 허위 표시가 되므로,
// 줄을 고칠 때는 반드시 대응하는 게이팅 코드도 함께 확인할 것.
//   - 해설 하루 한도: lib/explanation-rate-limit.ts (FREE_EXPLANATION_DAILY_PAPERS)
//   - 오답노트/복습/진단: app/mypage/** 의 isPremium 확인
const FEATURE_ROWS: { label: string; free: string | boolean; premium: string | boolean }[] = [
  { label: "기출문제·정답 열람", free: true, premium: true },
  { label: "문제지 PDF 다운로드", free: true, premium: true },
  { label: "CBT 온라인 풀이·채점", free: true, premium: true },
  { label: "댓글·난이도 평가·북마크", free: true, premium: true },
  {
    label: "문항 해설",
    free: `하루 문제지 ${FREE_EXPLANATION_DAILY_PAPERS}개`,
    premium: "제한 없음",
  },
  { label: "오답노트 전체 기능", free: false, premium: true },
  { label: "복습 (간격 반복 스케줄)", free: false, premium: true },
  { label: "AI 약점 진단", free: false, premium: true },
];

function FeatureTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[26rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="py-3 text-left font-medium text-zinc-500 dark:text-zinc-500">
              기능
            </th>
            <th className="w-28 py-3 text-center font-medium text-zinc-500 dark:text-zinc-500">
              무료
            </th>
            <th className="w-32 py-3 text-center font-bold text-blue-600 dark:text-blue-400">
              멤버십
            </th>
          </tr>
        </thead>
        <tbody>
          {FEATURE_ROWS.map((row) => (
            <tr
              key={row.label}
              className="border-b border-zinc-100 last:border-0 dark:border-zinc-800"
            >
              <td className="py-3 pr-3 text-zinc-700 dark:text-zinc-300">{row.label}</td>
              <td className="py-3 text-center">
                <Cell value={row.free} />
              </td>
              <td className="bg-blue-50/40 py-3 text-center dark:bg-blue-950/20">
                <Cell value={row.premium} highlight />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ value, highlight }: { value: string | boolean; highlight?: boolean }) {
  if (value === true) {
    return (
      <Check
        size={17}
        className={`mx-auto ${highlight ? "text-blue-600 dark:text-blue-400" : "text-emerald-500"}`}
        aria-label="제공"
      />
    );
  }
  if (value === false) {
    return (
      <Minus size={17} className="mx-auto text-zinc-300 dark:text-zinc-700" aria-label="제공 안 함" />
    );
  }
  return (
    <span
      className={`text-xs font-medium ${
        highlight ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400"
      }`}
    >
      {value}
    </span>
  );
}

// 결제가 열리기 전이라, 답을 쓸 수 있는 것만 쓴다. "언제든 해지 가능" 같은 문장은
// 해지 화면이 실제로 생긴 뒤에 넣을 것 — 지금 적으면 지킬 수 없는 약속이 된다.
const FAQ: { q: string; a: React.ReactNode }[] = [
  {
    q: "결제하면 바로 쓸 수 있나요?",
    a: (
      <>
        결제 기능은 아직 준비 중이에요. 요금제와 가격은 이 페이지 내용대로 확정됐고,
        결제가 열리면 서비스 안에서 안내해 드릴게요.
      </>
    ),
  },
  {
    q: "무료로는 해설을 아예 못 보나요?",
    a: (
      <>
        볼 수 있어요. 무료 회원은 하루에 문제지 {FREE_EXPLANATION_DAILY_PAPERS}개까지
        해설을 열어볼 수 있고, <b>오늘 이미 연 문제지를 다시 여는 건 횟수에 들어가지
        않아요</b>. 같은 해설을 다시 확인하려고 한도를 쓰게 만들지는 않으려고요. 한도는
        매일 자정(한국 시간)에 초기화돼요.
      </>
    ),
  },
  {
    q: "멤버십이 끝나면 오답노트가 사라지나요?",
    a: (
      <>
        아니요. 틀린 문제·메모·복습 기록은 그대로 남아 있고, 화면만 잠깁니다. 다시
        시작하면 쌓여 있던 그대로 이어서 쓸 수 있어요.
      </>
    ),
  },
  {
    q: "기간이 긴 요금제가 왜 더 싼가요?",
    a: (
      <>
        시험 준비는 몇 달 단위로 하는 일이라, 오래 쓰는 분에게 그만큼 돌려드리는 게
        맞다고 봤어요. 1년 요금제는 1개월 요금제를 열두 번 결제할 때보다{" "}
        <b>{formatWon(allPlanPricing()[2].savedAmount)}</b> 저렴합니다.
      </>
    ),
  },
  {
    q: "웹에서 결제하면 앱에서도 되나요?",
    a: <>네. 멤버십은 계정에 붙어서, 같은 계정으로 로그인하면 웹·앱 어디서나 적용돼요.</>,
  },
  {
    q: "환불은 어떻게 하나요?",
    a: (
      <>
        전자상거래법에 따라 결제일로부터 7일 이내에 멤버십 기능을 이용하지 않았다면
        전액 환불해 드려요. 이미 이용한 경우에는 남은 기간만큼 계산해 돌려드립니다.
        자세한 조건은 <Link href="/terms" className="underline underline-offset-2">이용약관</Link>에
        있어요.
      </>
    ),
  },
];

function Faq() {
  return (
    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {FAQ.map((item) => (
        <details key={item.q} className="group py-3">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-sm font-bold text-zinc-800 dark:text-zinc-200">
            {item.q}
            <span className="shrink-0 text-lg text-zinc-300 transition-transform group-open:rotate-45 dark:text-zinc-600">
              +
            </span>
          </summary>
          <p className="mt-2 break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            {item.a}
          </p>
        </details>
      ))}
    </div>
  );
}
