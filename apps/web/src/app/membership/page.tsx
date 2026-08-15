import type { Metadata } from "next";
import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getMembership, isAdminUser } from "@/lib/membership";
import { MembershipPlans } from "@/components/membership-plans";
import { sanitizeNextPath } from "@/lib/safe-redirect";
import { enabledEasyPayMethods, isTossConfigured } from "@/lib/toss";
import {
  BASE_MONTHLY_PRICE,
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
  // PG 키가 설정된 환경에서만 결제창이 열린다. 키가 없으면 버튼도 안내도 예전처럼
  // "준비 중"으로 남는다 — 계약이 끝나기 전에 이 코드가 배포돼도 안전하게 하려는 것.
  const paymentEnabled = isTossConfigured();
  // 요금제 아래에 따로 버튼을 둘 간편결제(카카오페이·네이버페이 등). 계약이 끝난 수단만
  // 환경변수에 적혀 있고, 비어 있으면 결제수단 줄이 아예 그려지지 않는다 — 지금까지처럼
  // 결제 버튼 하나가 카드/간편결제 통합결제창을 연다.
  const easyPayMethods = paymentEnabled ? enabledEasyPayMethods() : [];

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
        {/* 좁은 화면에서 두 줄로 딱 떨어지게 줄바꿈을 직접 넣는다. 브라우저에 맡기면
            "두 번은 안" / "틀리게" 처럼 어정쩡한 데서 접힌다. sm 이상은 한 줄. */}
        <h1 className="break-keep text-3xl font-extrabold leading-tight text-zinc-900 dark:text-zinc-100">
          한 번 틀린 문제,{" "}
          <br className="sm:hidden" />
          <span className="text-blue-600 dark:text-blue-400">두 번은 안 틀리게</span>
        </h1>
        <CurrentStatus premium={premium} admin={admin} daysLeft={daysLeft} loggedIn={!!user} />
      </header>

      {/* 요금제 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>요금제</SectionTitle>
        <MembershipPlans
          alreadyPremium={premium}
          paymentEnabled={paymentEnabled}
          easyPayMethods={easyPayMethods}
        />
      </section>

      {/* 무료 vs 멤버십 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>무료와 어떤 점이 다른가요</SectionTitle>
        <FeatureTable />
      </section>

      {/* 체험 안내 — 기간은 core 의 TRIAL_DAYS 하나에서 온다. 이벤트가 끝나 상수를
          되돌리면 이 문구도 같이 바뀐다(개월 수를 여기 적어두면 상수만 바뀌고 화면은
          옛 기간을 계속 광고하게 된다). */}
      <section className="flex flex-col gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/60 px-5 py-4 dark:border-emerald-900/60 dark:bg-emerald-950/20">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-emerald-900 dark:text-emerald-200">
          <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-extrabold text-white">
            이벤트
          </span>
          지금 시작하면 {Math.round(TRIAL_DAYS / 30)}달 무료
        </p>
        <p className="break-keep text-sm leading-6 text-emerald-800/90 dark:text-emerald-300/80">
          이벤트 기간에 가입하시면 멤버십 전체를 {TRIAL_DAYS}일 동안 무료로 드려요.
          가입하는 순간부터 바로 적용돼요 &mdash; 카드 등록 없고, 기간이 끝나도 자동으로
          결제되지 않아요.
        </p>
      </section>

      {/* 자주 묻는 질문 */}
      <section className="flex flex-col gap-4">
        <SectionTitle>자주 묻는 질문</SectionTitle>
        <Faq paymentEnabled={paymentEnabled} />
      </section>

      {user && (
        <p className="-mt-4 text-center text-xs text-zinc-500 dark:text-zinc-500">
          <Link
            href="/mypage/payments"
            className="underline underline-offset-2 hover:text-blue-600 dark:hover:text-blue-400"
          >
            내 결제 내역 보기
          </Link>
        </p>
      )}

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
    free: `하루 ${FREE_EXPLANATION_DAILY_PAPERS}개`,
    premium: "제한 없음",
  },
  { label: "오답노트 전체 기능", free: false, premium: true },
  { label: "복습 (간격 반복)", free: false, premium: true },
  { label: "AI 약점 진단", free: false, premium: true },
];

// 좁은 화면에서 가로 스크롤이 생기지 않게 폭을 짠다. min-width 를 걸어두면 375px
// 기기에서 표가 통째로 옆으로 밀려, 정작 비교하려는 두 칸이 화면 밖으로 나간다.
// 값 칸만 고정폭(무료 4.5rem / 멤버십 5rem)으로 잡고 기능 이름은 남는 폭을 쓰며
// break-keep 으로 접는다. overflow-x-auto 는 글자 크기를 키운 사용자를 위한 안전망.
function FeatureTable() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col />
          <col className="w-[4.5rem] sm:w-28" />
          <col className="w-[5rem] sm:w-32" />
        </colgroup>
        <thead>
          <tr className="border-b border-zinc-200 dark:border-zinc-700">
            <th className="py-3 text-left text-xs font-medium text-zinc-500 sm:text-sm dark:text-zinc-500">
              기능
            </th>
            <th className="py-3 text-center text-xs font-medium text-zinc-500 sm:text-sm dark:text-zinc-500">
              무료
            </th>
            <th className="py-3 text-center text-xs font-bold text-blue-600 sm:text-sm dark:text-blue-400">
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
              <td className="break-keep py-3 pr-2 text-xs text-zinc-700 sm:pr-3 sm:text-sm dark:text-zinc-300">
                {row.label}
              </td>
              <td className="px-1 py-3 text-center">
                <Cell value={row.free} />
              </td>
              <td className="bg-blue-50/40 px-1 py-3 text-center dark:bg-blue-950/20">
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
      className={`block break-keep text-[11px] font-medium leading-4 sm:text-xs ${
        highlight ? "text-blue-700 dark:text-blue-300" : "text-zinc-600 dark:text-zinc-400"
      }`}
    >
      {value}
    </span>
  );
}

// 답을 쓸 수 있는 것만 쓴다. "언제든 해지 가능" 같은 문장은 해지 화면이 실제로 생긴
// 뒤에 넣을 것 — 지금 적으면 지킬 수 없는 약속이 된다.
//
// 첫 문답은 결제가 실제로 열렸는지에 따라 달라진다. 열린 뒤에도 "준비 중"이 남아
// 있으면 결제한 사람이 자기 결제를 의심하게 된다.
function faqItems(paymentEnabled: boolean): { q: string; a: React.ReactNode }[] {
  return [
  {
    q: "결제하면 바로 쓸 수 있나요?",
    a: paymentEnabled ? (
      <>
        네, 결제가 끝나면 바로 열려요. 남은 무료 기간이 있으면 <b>그 기간에 이어서</b>{" "}
        더해 드리니, 일찍 결제한다고 손해 보지 않아요. 정기결제가 아니라 기간이 끝나면
        자동으로 다시 결제되지 않습니다.
      </>
    ) : (
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
    q: "환불은 어떻게 하나요?",
    a: (
      <>
        결제일로부터 7일 이내이고 멤버십 기능을 한 번도 쓰지 않았다면 전액 환불해
        드려요. 이미 쓰기 시작한 뒤 해지하시면 남은 기간에 해당하는 금액에서 위약금
        10%를 뺀 금액을 환불해 드립니다. 이때 이미 쓰신 기간은 할인 전 정상가(월{" "}
        {formatWon(BASE_MONTHLY_PRICE)}) 기준으로 계산해요 &mdash; 장기 요금제 할인은
        그 기간을 다 쓰는 것을 전제로 드린 것이라서요. 자세한 조건은{" "}
        <Link href="/terms" className="underline underline-offset-2">
          이용약관
        </Link>
        에 있어요.
      </>
    ),
  },
  ];
}

function Faq({ paymentEnabled }: { paymentEnabled: boolean }) {
  return (
    <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
      {faqItems(paymentEnabled).map((item) => (
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
