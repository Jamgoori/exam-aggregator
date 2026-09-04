import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { BarChart3, Lightbulb, PenLine } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPremium } from "@/lib/membership";
import {
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_MIN_WRONG,
  DIAGNOSIS_WINDOW_DAYS,
  getDiagnosisEligibility,
  getWeeklyDiagnosis,
  kstToday,
  nextDiagnosisDate,
} from "@/lib/ai-diagnosis";
import { COACH_MAX_TOTAL } from "@/lib/diagnosis-limits";
import { DiagnosisProgress } from "@/components/diagnosis-progress";
import { DiagnosisSampleReport } from "@/components/diagnosis-sample-report";

export const metadata: Metadata = {
  title: "AI 약점 진단",
  description: `${DIAGNOSIS_CYCLE_DAYS}일에 한 번, 내가 왜 틀리는지 개념 단위로 진단하고 극복법을 받아보세요.`,
  alternates: { canonical: "/diagnosis" },
};

// AI 약점 진단의 전용 안내 페이지.
//
// 처음 들어온 사람이 30초 안에 "이게 뭘 해주는 기능인지"만 알고 나가면 성공이다.
// 그래서 첫 화면에 세우는 것은 딱 세 덩어리다 — 한 줄 정의 · 지금 할 수 있는 행동 하나 ·
// 3단계 설명. 나머지(규칙 상세·FAQ)는 전부 접어 두고, 궁금한 사람만 펼친다.
// 예전 버전은 히어로 아래에 특징 배지·기능 카드 4장·규칙 8줄을 다 펼쳐 뒀는데,
// 첫 방문자에게는 그게 정보가 아니라 벽이었다.
//
// 여기 적힌 숫자는 손으로 쓰지 않는다 — 전부 규칙을 실제로 집행하는 상수에서 온다
// (lib/ai-diagnosis.ts, lib/diagnosis-limits.ts). 화면만 옛 숫자를 광고하면 허위 안내다.
export default async function DiagnosisAboutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [premium, eligibility, weekly] = user
    ? await Promise.all([
        isPremium(supabase, user.id),
        getDiagnosisEligibility(supabase, user.id),
        getWeeklyDiagnosis(supabase, user.id),
      ])
    : [false, null, null];

  const nextDate = weekly ? nextDiagnosisDate(weekly.date) : null;
  const daysLeft = nextDate ? daysUntil(nextDate) : null;
  const cta = ctaFor({
    loggedIn: !!user,
    premium,
    eligible: eligibility?.eligible ?? false,
    daysLeft,
  });

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-8 px-4 pb-20 pt-8 sm:pt-12">
      <Hero cta={cta} />
      {/* 로그인했는데 아직 자격이 안 되는 사람에게는 "얼마나 남았는지"를 바로 보여준다.
          CTA 의 한 줄 안내(오답 15개 또는 응시 3회)보다 내 숫자가 박힌 바가 더 움직인다.
          자격이 되면 CTA 가 이미 "진단 받으러 가기"라 바를 겹쳐 두지 않는다. */}
      {eligibility && !eligibility.eligible && (
        <DiagnosisProgress
          attemptCount={eligibility.attemptCount}
          wrongCount={eligibility.wrongCount}
          lockedHref="/papers"
        />
      )}
      <Steps />
      {/* 3단계를 읽고 나서 "그래서 결과가 어떻게 생겼는데"에 답하는 자리. 진단은 응시
          3회 뒤에야 열리므로, 결과물을 미리 보여주지 않으면 세 번 올 이유가 없다. */}
      <DiagnosisSampleReport />
      <Details />
    </div>
  );
}

// ── CTA ──────────────────────────────────────────────────────────────────────
// 버튼은 페이지에 하나뿐이다 — 지금 이 사람이 할 수 있는 단 하나의 다음 행동.
// 로그인 → 멤버십 → 문제 더 풀기 → 진단 보기 순으로 막히는 곳을 먼저 푼다.
type Cta = { href: string; label: string; note: string | null };

function ctaFor({
  loggedIn,
  premium,
  eligible,
  daysLeft,
}: {
  loggedIn: boolean;
  premium: boolean;
  eligible: boolean;
  // 다음 진단까지 남은 일수(이번 주기에 이미 받았을 때만).
  daysLeft: number | null;
}): Cta {
  if (!loggedIn) {
    return {
      href: `/login?next=${encodeURIComponent("/diagnosis")}`,
      label: "로그인하고 시작하기",
      note: null,
    };
  }
  if (!premium) {
    return {
      href: `/membership?next=${encodeURIComponent("/diagnosis")}`,
      label: "멤버십 보러 가기",
      note: "AI 약점 진단은 멤버십 기능이에요.",
    };
  }
  if (!eligible) {
    return {
      href: "/mypage?tab=wrong-notes",
      label: "문제 풀러 가기",
      note: `오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회를 넘기면 진단이 열려요.`,
    };
  }
  if (daysLeft != null && daysLeft > 0) {
    return {
      href: "/mypage/diagnosis",
      label: "내 진단 보기",
      note: `다음 진단은 ${daysLeft}일 뒤부터 받을 수 있어요.`,
    };
  }
  return { href: "/mypage/diagnosis", label: "진단 받으러 가기", note: null };
}

function Hero({ cta }: { cta: Cta }) {
  return (
    <header className="flex flex-col items-center gap-4 text-center">
      <span className="rounded-full bg-violet-100 px-3 py-1 text-[11px] font-bold text-violet-700 dark:bg-violet-950/50 dark:text-violet-300">
        멤버십 · {DIAGNOSIS_CYCLE_DAYS}일에 1회
      </span>
      {/* 좁은 화면에서 어정쩡한 데서 접히지 않게 줄바꿈을 직접 넣는다. sm 이상은 한 줄. */}
      <h1 className="break-keep text-[26px] font-extrabold leading-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
        틀린 문제 말고,{" "}
        <br className="sm:hidden" />
        <span className="text-violet-600 dark:text-violet-400">틀리는 이유</span>를 봅니다
      </h1>
      <p className="max-w-md break-keep text-sm leading-7 text-zinc-600 dark:text-zinc-400">
        최근 {DIAGNOSIS_WINDOW_DAYS}일에 틀린 문항을 개념 단위로 다시 세우고, 고른 개념마다
        내가 고른 오답 하나하나를 짚어 &ldquo;왜 그렇게 골랐는지 · 그래서 뭘 하면 되는지&rdquo;를
        써 드려요. 따로 입력할 건 없어요.
      </p>
      <Link
        href={cta.href}
        // 대시보드는 진입 즉시 계정 전체 오답을 훑는 무거운 집계를 돌린다. 프리페치는
        // 링크가 화면에 보이기만 해도 그 렌더를 시켜 버리므로 끈다.
        prefetch={false}
        className="mt-1 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-violet-700 sm:w-auto"
      >
        {cta.label}
        <span aria-hidden>→</span>
      </Link>
      {cta.note && (
        <p className="break-keep text-xs text-zinc-500 dark:text-zinc-500">{cta.note}</p>
      )}
    </header>
  );
}

// ── 3단계 ────────────────────────────────────────────────────────────────────
const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <PenLine size={16} />,
    title: "평소처럼 풉니다",
    body: "CBT·섞어풀기·복습에서 채점된 기록이 그대로 쌓여요.",
  },
  {
    icon: <BarChart3 size={16} />,
    title: "개념별로 모아 보여줘요",
    body: "문항이 아니라 개념이 축이에요. 어떤 개념에서 몇 번 무너졌는지 그래프로 바로 보여요.",
  },
  {
    icon: <Lightbulb size={16} />,
    title: "극복법을 받아요",
    body:
      "고른 개념마다 내 오답을 근거로 원인·극복 계획·시험장 체크리스트를 써 주고, 같은 개념 기출 5문제를 그 자리에서 풀 수 있어요.",
  },
];

function Steps() {
  return (
    <ol className="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
      {STEPS.map((s, i) => (
        <li key={s.title} className="flex items-start gap-3 p-4">
          <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
            {s.icon}
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              {i + 1}. {s.title}
            </p>
            <p className="mt-0.5 break-keep text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">
              {s.body}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

// ── 접어 둔 상세 ─────────────────────────────────────────────────────────────
// 규칙과 FAQ는 처음 보는 사람에게 필요한 정보가 아니다. 필요한 사람만 펼치도록
// 접어 두되, 안에 들어가는 내용은 실제 동작 그대로 적는다.
const RULES: { label: string; value: string }[] = [
  { label: "진단 주기", value: `${DIAGNOSIS_CYCLE_DAYS}일에 1회 (받은 날부터 ${DIAGNOSIS_CYCLE_DAYS}일)` },
  { label: "분석 기간", value: `최근 ${DIAGNOSIS_WINDOW_DAYS}일 안에 틀린 문제에서 개념 선정` },
  {
    label: "극복법 개수",
    value: `직접 고른 개념에 한 번에 최대 ${COACH_MAX_TOTAL}개`,
  },
  { label: "그래프", value: "주기와 무관하게 항상 실시간" },
  {
    label: "받을 수 있는 조건",
    value: `멤버십 · 오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회`,
  },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: `왜 ${DIAGNOSIS_CYCLE_DAYS}일에 한 번인가요?`,
    a: (
      <>
        하루 만에 약점이 바뀌지는 않아서예요. 매일 새로 뽑으면 어제와 거의 같은 말을 다시
        읽게 되고, 정작 메우는 시간이 사라져요. 개념 그래프는 주기와 무관하게 실시간이라
        오늘 푼 결과는 바로 볼 수 있어요.
      </>
    ),
  },
  {
    q: "어떤 개념에 극복법이 붙나요?",
    a: (
      <>
        진단 화면에서 직접 고른 개념에 붙어요. 한 번에 최대 {COACH_MAX_TOTAL}개까지 고를 수
        있고, 처음에는 많이 틀린 개념이 미리 체크돼 있어요 — 그대로 눌러도 되고, 시험이
        가까운 과목 위주로 바꿔도 돼요.
      </>
    ),
  },
  {
    q: "오래전에 틀린 문제도 분석하나요?",
    a: (
      <>
        극복법에 넣을 개념은 최근 {DIAGNOSIS_WINDOW_DAYS}일 안에 틀린 문제에서 골라요 — 지금
        무엇에서 무너지는지를 보는 게 목적이라서요. 다만 그 개념의 근거로는 예전에 틀린 문항까지
        같이 봅니다. 그래프는 기간을 &lsquo;전체&rsquo;로 바꾸면 지금까지 쌓인 오답을 전부 놓고
        볼 수 있어요.
      </>
    ),
  },
  {
    q: "멤버십이 끝나면 기록도 사라지나요?",
    a: <>아니요. 잠기는 건 진단 화면이고, 오답 기록은 그대로 남아 다시 시작하면 이어집니다.</>,
  },
];

function Details() {
  return (
    <div className="flex flex-col gap-2">
      <Fold summary="규칙 자세히 보기">
        <dl className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {RULES.map((r) => (
            <div key={r.label} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5">
              <dt className="text-xs font-bold text-zinc-500 dark:text-zinc-400">{r.label}</dt>
              <dd className="break-keep text-[13px] font-semibold text-zinc-800 dark:text-zinc-200">
                {r.value}
              </dd>
            </div>
          ))}
        </dl>
      </Fold>
      <Fold summary="자주 묻는 질문">
        <div className="flex flex-col divide-y divide-zinc-100 dark:divide-zinc-800">
          {FAQ.map((item) => (
            <div key={item.q} className="py-3">
              <p className="text-[13px] font-bold text-zinc-800 dark:text-zinc-200">{item.q}</p>
              <p className="mt-1 break-keep text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">
                {item.a}
              </p>
            </div>
          ))}
        </div>
      </Fold>
    </div>
  );
}

function Fold({ summary, children }: { summary: string; children: ReactNode }) {
  return (
    <details className="group rounded-2xl border border-zinc-200 bg-white px-4 dark:border-zinc-800 dark:bg-zinc-900">
      <summary className="flex cursor-pointer list-none items-center justify-between py-3.5 text-sm font-bold text-zinc-700 dark:text-zinc-300">
        {summary}
        <span className="text-lg text-zinc-300 transition-transform group-open:rotate-45 dark:text-zinc-600">
          +
        </span>
      </summary>
      <div className="border-t border-zinc-100 pb-2 dark:border-zinc-800">{children}</div>
    </details>
  );
}

// 오늘(KST)부터 그 날짜까지 남은 일수. 이미 지났으면 0.
function daysUntil(date: string): number {
  const to = Date.parse(`${date}T00:00:00Z`);
  const from = Date.parse(`${kstToday()}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
