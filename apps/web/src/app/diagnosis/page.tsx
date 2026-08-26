import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  BarChart3,
  BookOpen,
  CalendarClock,
  CheckCircle2,
  Lightbulb,
  ListOrdered,
  Lock,
  Microscope,
  PenLine,
  Sparkles,
  Target,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { isPremium } from "@/lib/membership";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";
import {
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MAX_WINDOW_DAYS,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_MIN_WRONG,
  GRAPH_MIN_WINDOW_DAYS,
  getDiagnosisEligibility,
  getWeeklyDiagnosis,
  kstToday,
  nextDiagnosisDate,
} from "@/lib/ai-diagnosis";
import { COACH_MAX_TOTAL, COACH_PER_SUBJECT, TOP_CONCEPT_CARDS } from "@/lib/diagnosis-limits";

export const metadata: Metadata = {
  title: "AI 약점 진단",
  description: `내가 왜 틀리는지 개념 단위로 진단합니다. ${DIAGNOSIS_CYCLE_DAYS}일에 한 번, 취약 개념 TOP ${TOP_CONCEPT_CARDS}과 맞춤 극복법을 받아보세요.`,
  alternates: { canonical: "/diagnosis" },
};

// AI 약점 진단의 "전용 페이지"(요금제 페이지와 같은 급의 소개·규칙 문서).
//
// 대시보드(/mypage/diagnosis)는 이미 진단을 쓰는 사람의 화면이라, 규칙(주기·분석 기간·
// 상한·자격)을 그 안에 다 적으면 정작 볼 것이 밀린다. 그래서 "무엇을 어떻게 해주는
// 기능인지"는 전부 이 페이지가 맡고, 대시보드는 결과만 그린다.
//
// 여기 적힌 숫자는 하나도 손으로 쓰지 않는다 — 전부 규칙을 실제로 집행하는 상수에서
// 온다(lib/ai-diagnosis.ts, lib/diagnosis-limits.ts). 상한을 바꾸면 이 페이지의 설명도
// 같이 바뀌어야지, 화면만 옛 숫자를 광고하고 있으면 그 자체로 허위 안내가 된다.
export default async function DiagnosisAboutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 개발 중 임시 게이트: 기능 자체가 이 계정에만 열려 있으므로 소개 페이지도 같이
  // 닫아 둔다. 아직 아무도 쓸 수 없는 기능을 광고하면 문의만 쌓인다.
  // 정식 오픈 시 이 블록을 지우면 (로그인 없이도 보이는) 공개 소개 페이지가 된다.
  if (!isDiagnosisDevAllowed(user?.email)) {
    redirect("/membership");
  }

  // 로그인한 사람에게는 "지금 내 상태"까지 같이 보여준다. 소개만 읽고 나가면 자기가
  // 지금 진단을 받을 수 있는지를 결국 다른 화면에서 다시 확인해야 한다.
  const [premium, eligibility, weekly] = user
    ? await Promise.all([
        isPremium(supabase, user.id),
        getDiagnosisEligibility(supabase, user.id),
        getWeeklyDiagnosis(supabase, user.id),
      ])
    : [false, null, null];

  const nextDate = weekly ? nextDiagnosisDate(weekly.date) : null;
  const daysLeft = nextDate ? daysUntil(nextDate) : null;

  const cta = ctaFor({ loggedIn: !!user, premium, eligible: eligibility?.eligible ?? false, daysLeft });

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-12 px-4 pb-24 pt-6 sm:pt-10">
      <Hero cta={cta} />

      {user && (
        <MyStatus
          premium={premium}
          eligibility={eligibility}
          nextDate={nextDate}
          daysLeft={daysLeft}
        />
      )}

      <HowItWorks />
      <WhatYouGet />
      <Rules />
      <Faq />
      <FinalCta cta={cta} />
    </div>
  );
}

// ── CTA ──────────────────────────────────────────────────────────────────────
// 화면 어디에 놓든 버튼은 하나뿐이어야 한다 — 지금 이 사람이 할 수 있는 단 하나의
// 다음 행동. 로그인 → 멤버십 → 문제 더 풀기 → 진단 보기 순으로 막히는 곳을 먼저 푼다.
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
      note: "로그인하면 지금 진단을 받을 수 있는 상태인지 바로 보여드려요.",
    };
  }
  if (!premium) {
    return {
      href: `/membership?next=${encodeURIComponent("/diagnosis")}`,
      label: "멤버십 보러 가기",
      note: "AI 약점 진단은 멤버십 기능이에요. 쌓아둔 오답은 그대로 남아 있어요.",
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
      note: `이번 주기 진단은 이미 받았어요. 다음 진단은 ${daysLeft}일 뒤부터.`,
    };
  }
  return {
    href: "/mypage/diagnosis",
    label: "진단 받으러 가기",
    note: "지금 진단을 받을 수 있어요.",
  };
}

function CtaButton({ cta }: { cta: Cta }) {
  return (
    <Link
      href={cta.href}
      // 대시보드는 진입 즉시 계정 전체 오답을 훑는 무거운 집계를 돌린다. 프리페치는
      // 링크가 화면에 보이기만 해도 그 렌더를 시켜 버리므로 끈다.
      prefetch={false}
      className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-6 py-3.5 text-base font-bold text-white shadow-sm transition-colors hover:bg-violet-700"
    >
      {cta.label}
      <span aria-hidden>→</span>
    </Link>
  );
}

// ── 히어로 ───────────────────────────────────────────────────────────────────
function Hero({ cta }: { cta: Cta }) {
  return (
    <header className="flex flex-col items-center gap-4 rounded-3xl border border-violet-200 bg-gradient-to-b from-violet-50 to-white px-5 py-10 text-center sm:px-10 sm:py-14 dark:border-violet-900/50 dark:from-violet-950/30 dark:to-zinc-950">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-600 px-3 py-1 text-[11px] font-extrabold text-white">
        <Sparkles size={12} /> 멤버십 · {DIAGNOSIS_CYCLE_DAYS}일에 1회
      </span>
      {/* 좁은 화면에서 어정쩡한 데서 접히지 않게 줄바꿈을 직접 넣는다. sm 이상은 한 줄. */}
      <h1 className="break-keep text-[26px] font-extrabold leading-tight text-zinc-900 sm:text-4xl dark:text-zinc-100">
        틀린 문제 말고,{" "}
        <br className="sm:hidden" />
        <span className="text-violet-600 dark:text-violet-400">틀리는 이유</span>를 봅니다
      </h1>
      <p className="max-w-xl break-keep text-sm leading-7 text-zinc-600 sm:text-base dark:text-zinc-400">
        최근 {DIAGNOSIS_MAX_WINDOW_DAYS}일 안에 틀린 문항을 개념 단위로 다시 세우고, 가장
        많이 무너진 개념 <b className="text-zinc-900 dark:text-zinc-200">TOP {TOP_CONCEPT_CARDS}</b>
        에 맞춤 극복법과 같은 개념 기출을 붙여 드려요. 따로 입력할 건 없어요 &mdash; 평소처럼
        풀기만 하면 돼요.
      </p>
      <div className="mt-1 flex flex-col items-center gap-2">
        <CtaButton cta={cta} />
        {cta.note && (
          <p className="break-keep text-xs text-zinc-500 dark:text-zinc-500">{cta.note}</p>
        )}
      </div>
      <ul className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 text-xs font-semibold text-violet-800/80 dark:text-violet-300/80">
        <li className="flex items-center gap-1">
          <CheckCircle2 size={13} /> 개념 축으로 집계
        </li>
        <li className="flex items-center gap-1">
          <CheckCircle2 size={13} /> 그래프는 실시간
        </li>
        <li className="flex items-center gap-1">
          <CheckCircle2 size={13} /> 극복법은 {DIAGNOSIS_CYCLE_DAYS}일에 1회
        </li>
      </ul>
    </header>
  );
}

// ── 내 상태 ──────────────────────────────────────────────────────────────────
// 로그인한 사람에게만. "나는 지금 어디까지 왔나"를 한 카드로 끝낸다.
function MyStatus({
  premium,
  eligibility,
  nextDate,
  daysLeft,
}: {
  premium: boolean;
  eligibility: Awaited<ReturnType<typeof getDiagnosisEligibility>> | null;
  nextDate: string | null;
  daysLeft: number | null;
}) {
  const wrong = eligibility?.wrongCount ?? 0;
  const attempts = eligibility?.attemptCount ?? 0;
  const eligible = eligibility?.eligible ?? false;

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-zinc-900 dark:text-zinc-100">내 진단 상태</h2>
        {premium ? (
          eligible ? (
            daysLeft != null && daysLeft > 0 ? (
              <Pill tone="zinc">다음 진단까지 {daysLeft}일</Pill>
            ) : (
              <Pill tone="violet">지금 받을 수 있어요</Pill>
            )
          ) : (
            <Pill tone="zinc">데이터를 모으는 중</Pill>
          )
        ) : (
          <Pill tone="zinc">멤버십 필요</Pill>
        )}
      </div>

      {/* 자격은 "둘 중 하나만" 넘기면 된다. 두 막대를 나란히 두고 or 로 잇는 이유다. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Meter label="누적 오답" value={wrong} goal={DIAGNOSIS_MIN_WRONG} unit="개" done={eligible} />
        <Meter
          label="응시 횟수"
          value={attempts}
          goal={DIAGNOSIS_MIN_ATTEMPTS}
          unit="회"
          done={eligible}
        />
      </div>
      <p className="break-keep text-xs leading-5 text-zinc-500 dark:text-zinc-500">
        {eligible
          ? nextDate && daysLeft != null && daysLeft > 0
            ? `이번 주기 진단은 받았어요. ${formatMonthDay(nextDate)}부터 다시 받을 수 있고, 그 사이에도 개념 그래프는 실시간으로 갱신돼요.`
            : "진단을 받을 조건은 이미 넘겼어요. 대시보드에서 과목을 고르고 극복법을 만들면 돼요."
          : (eligibility?.hint ??
            `오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회 중 하나만 넘기면 열려요.`)}
      </p>
    </section>
  );
}

function Meter({
  label,
  value,
  goal,
  unit,
  done,
}: {
  label: string;
  value: number;
  goal: number;
  unit: string;
  // 자격을 이미 얻었으면(다른 조건으로라도) 두 막대 모두 채워 보여준다 — 한쪽이
  // 비어 있으면 "아직 모자란다"로 읽힌다.
  done: boolean;
}) {
  const pct = done ? 100 : Math.min(100, Math.round((value / goal) * 100));
  return (
    <div className="rounded-xl bg-zinc-50 p-3 dark:bg-zinc-800/50">
      <p className="flex items-baseline justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span className="font-semibold">{label}</span>
        <span>
          <b className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{value}</b>
          {unit} / {goal}
          {unit}
        </span>
      </p>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
        <div
          className={`h-full rounded-full ${done ? "bg-emerald-500" : "bg-violet-500"}`}
          style={{ width: `${Math.max(3, pct)}%` }}
        />
      </div>
    </div>
  );
}

function Pill({ tone, children }: { tone: "violet" | "zinc"; children: ReactNode }) {
  const cls =
    tone === "violet"
      ? "bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300"
      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400";
  return <span className={`rounded-full px-3 py-1 text-xs font-bold ${cls}`}>{children}</span>;
}

// ── 작동 방식 ────────────────────────────────────────────────────────────────
const STEPS: { icon: ReactNode; title: string; body: string }[] = [
  {
    icon: <PenLine size={18} />,
    title: "평소처럼 풉니다",
    body: "CBT·섞어풀기·오늘의 복습에서 채점된 기록이 그대로 쌓여요. 진단을 위해 따로 풀거나 입력할 건 없어요.",
  },
  {
    icon: <Microscope size={18} />,
    title: "개념 단위로 다시 셉니다",
    body: `문항이 아니라 개념이 축이에요. 같은 개념을 여러 회차에서 틀렸다면 한 줄로 합쳐져, "이 개념이 ${DIAGNOSIS_MAX_WINDOW_DAYS}일 동안 몇 번 무너졌는지"가 보여요.`,
  },
  {
    icon: <Lightbulb size={18} />,
    title: "AI가 극복법을 씁니다",
    body: `실제로 틀린 문항을 근거로, 개념마다 "주로 어떤 식으로 틀리는지"와 "그래서 뭘 하면 되는지"를 써 줘요. ${DIAGNOSIS_CYCLE_DAYS}일에 한 번 만들어 그동안 계속 볼 수 있어요.`,
  },
];

function HowItWorks() {
  return (
    <section className="flex flex-col gap-5">
      <SectionTitle sub="따로 준비할 건 없어요. 세 단계로 끝나요.">이렇게 진행돼요</SectionTitle>
      <ol className="flex flex-col gap-3">
        {STEPS.map((s, i) => (
          <li
            key={s.title}
            className="flex gap-4 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex flex-col items-center gap-2">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-violet-600 text-sm font-extrabold text-white">
                {i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span className="w-px flex-1 bg-zinc-200 dark:bg-zinc-700" aria-hidden />
              )}
            </div>
            <div className="min-w-0 pb-1">
              <p className="flex items-center gap-2 text-[15px] font-bold text-zinc-900 dark:text-zinc-100">
                <span className="text-violet-600 dark:text-violet-400">{s.icon}</span>
                {s.title}
              </p>
              <p className="mt-1 break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                {s.body}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── 무엇을 받나 ──────────────────────────────────────────────────────────────
const FEATURES: { icon: ReactNode; title: string; body: string; tag: string }[] = [
  {
    icon: <BarChart3 size={18} />,
    title: "과목별 틀린 개념 그래프",
    body: `어떤 개념에서 몇 문항 틀렸는지 막대로 세워요. 기간(최근 ${GRAPH_MIN_WINDOW_DAYS}일·30일·전체)과 과목을 눌러 바꿀 수 있고, 진단과 달리 항상 실시간이에요.`,
    tag: "실시간",
  },
  {
    icon: <ListOrdered size={18} />,
    title: `취약 개념 카드 TOP ${TOP_CONCEPT_CARDS}`,
    body: `오답이 많은 순으로 최대 ${TOP_CONCEPT_CARDS}개. 카드마다 틀린 횟수·내 정답률·남은 기출 수, 그리고 '이 개념을 다 맞혔다면 점수가 몇 점 높았는지'가 같이 붙어요.`,
    tag: `상위 ${TOP_CONCEPT_CARDS}개`,
  },
  {
    icon: <Lightbulb size={18} />,
    title: "AI 맞춤 극복법",
    body: `내가 실제로 틀린 문항을 근거로 쓴 두세 문장. 한 번 만들 때 과목당 최대 ${COACH_PER_SUBJECT}개, 전체 최대 ${COACH_MAX_TOTAL}개 개념을 다뤄요.`,
    tag: `${DIAGNOSIS_CYCLE_DAYS}일 1회`,
  },
  {
    icon: <Target size={18} />,
    title: "같은 개념 기출 5문제",
    body: "카드에서 바로 그 개념만 모은 5문제를 만들어 풀 수 있어요. 진단을 읽고 끝내지 않고 그 자리에서 메우라고 붙인 버튼이에요.",
    tag: "바로 풀기",
  },
];

function WhatYouGet() {
  return (
    <section className="flex flex-col gap-5">
      <SectionTitle sub="진단 화면에 들어가면 이 네 가지가 보여요.">무엇을 받나요</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div
            key={f.title}
            className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-start justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400">
                {f.icon}
              </span>
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[10px] font-bold text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                {f.tag}
              </span>
            </div>
            <p className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{f.title}</p>
            <p className="break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
              {f.body}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── 규칙 ─────────────────────────────────────────────────────────────────────
// 각 줄의 "왜"까지 같이 적는다. 상한만 나열하면 인색해 보이지만, 이유를 붙이면
// 대부분은 "그래서 이렇게 쓰면 되는구나"로 읽힌다.
const RULES: { icon: ReactNode; label: string; value: string; why: string }[] = [
  {
    icon: <CalendarClock size={16} />,
    label: "진단 주기",
    value: `${DIAGNOSIS_CYCLE_DAYS}일에 1회`,
    why: "달력 주가 아니라 받은 날부터 7일이에요. 금요일에 받았다면 다음은 그다음 주 금요일. 하루 만에 사람의 약점이 바뀌지는 않아서, 그 사이에는 같은 진단을 계속 보며 메우는 편이 낫다고 봤어요.",
  },
  {
    icon: <Microscope size={16} />,
    label: "분석 기간",
    value: `지난 진단 이후 (최대 ${DIAGNOSIS_MAX_WINDOW_DAYS}일)`,
    why: "이미 진단한 오답을 다시 진단하지 않으려고 지난 진단 이후만 봐요. 오래 쉬었다 돌아와도 2주치까지만 거슬러 올라가요 — 그보다 오래된 오답은 '지금 무엇을 틀리는가'의 근거로 약하니까요.",
  },
  {
    icon: <ListOrdered size={16} />,
    label: "개념 카드",
    value: `TOP ${TOP_CONCEPT_CARDS}`,
    why: `오답이 많은 순으로 ${TOP_CONCEPT_CARDS}위까지만 세워요. 그 아래는 이 주기의 우선순위라고 부르기 어렵고, 목록이 길수록 1위의 무게가 옅어져요.`,
  },
  {
    icon: <Lightbulb size={16} />,
    label: "AI 극복법",
    value: `과목당 ${COACH_PER_SUBJECT}개 · 한 번에 ${COACH_MAX_TOTAL}개`,
    why: "전체 상위 N개만 뽑으면 문항을 많이 푼 한두 과목이 자리를 다 가져가요. 과목당으로 끊어야 준비하는 모든 과목이 최소한 다뤄져요.",
  },
  {
    icon: <BarChart3 size={16} />,
    label: "그래프",
    value: "항상 실시간",
    why: `극복법과 달리 주기가 없어요. 방금 푼 회차도 바로 반영되고, 기간 칩(최근 ${GRAPH_MIN_WINDOW_DAYS}일·30일·전체)과 과목 칩으로 좁혀 볼 수 있어요.`,
  },
  {
    icon: <CheckCircle2 size={16} />,
    label: "받을 수 있는 조건",
    value: `오답 ${DIAGNOSIS_MIN_WRONG}개 또는 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회`,
    why: "둘 중 하나만 넘기면 돼요. 데이터가 빈약하면 진단이 뻔해져서, 최소한의 기록이 쌓인 뒤에 열어요.",
  },
  {
    icon: <BookOpen size={16} />,
    label: "과목 고르기",
    value: "진단에서 뺄 과목 선택",
    why: "이번에 준비하지 않는 과목은 빼두면, 남은 과목을 그만큼 더 깊게 봐요. 진단 화면의 선택창에서 언제든 바꿀 수 있어요.",
  },
  {
    icon: <Lock size={16} />,
    label: "이용 조건",
    value: "멤버십 회원",
    why: "멤버십이 끝나도 오답 기록과 개념 집계는 그대로 남아요. 다시 시작하면 이어서 진단받을 수 있어요.",
  },
];

function Rules() {
  return (
    <section id="rules" className="flex flex-col gap-5 scroll-mt-20">
      <SectionTitle sub="숫자로 정해둔 것들. 화면에서 실제로 그렇게 동작해요.">
        규칙 한눈에
      </SectionTitle>
      <div className="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {RULES.map((r) => (
          <div key={r.label} className="flex flex-col gap-1 p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="flex items-center gap-1.5 text-xs font-bold text-zinc-500 dark:text-zinc-400">
                <span className="text-violet-500 dark:text-violet-400">{r.icon}</span>
                {r.label}
              </span>
              <span className="rounded-lg bg-violet-50 px-2 py-0.5 text-[13px] font-extrabold text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">
                {r.value}
              </span>
            </div>
            <p className="break-keep text-xs leading-6 text-zinc-600 dark:text-zinc-400">{r.why}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────
// 지킬 수 있는 것만 쓴다. 화면 동작과 어긋나는 문장은 그 자체로 허위 안내가 된다.
const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: `왜 매일이 아니라 ${DIAGNOSIS_CYCLE_DAYS}일에 한 번인가요?`,
    a: (
      <>
        하루 만에 약점이 바뀌지는 않기 때문이에요. 매일 새로 뽑으면 어제와 거의 같은 말을
        다른 문장으로 읽게 되고, 정작 <b>메우는 시간</b>이 사라져요. 대신 개념 그래프는
        주기와 무관하게 실시간이라, 오늘 푼 결과는 바로 확인할 수 있어요.
      </>
    ),
  },
  {
    q: `개념 카드가 ${TOP_CONCEPT_CARDS}개까지만 나오는 이유는요?`,
    a: (
      <>
        우선순위를 만드는 게 목적이라서요. 틀린 개념을 전부 나열하면 목록이 되지 진단이
        되지 않아요. 오답이 많은 순으로 {TOP_CONCEPT_CARDS}위까지 세우고, 그중에서도 위쪽
        개념부터 AI 극복법이 붙어요. 그 아래가 궁금하면 그래프에서 과목을 좁혀 보면
        돼요.
      </>
    ),
  },
  {
    q: "모든 개념에 극복법이 붙나요?",
    a: (
      <>
        아니요. 한 번 만들 때 과목당 최대 {COACH_PER_SUBJECT}개, 전체 최대{" "}
        {COACH_MAX_TOTAL}개 개념에 붙어요. 극복법이 없는 카드에도 틀린 횟수·정답률·기출
        수는 그대로 나오고, <b>같은 개념 기출 5문제</b>도 바로 풀 수 있어요.
      </>
    ),
  },
  {
    q: "몇 달 전에 틀린 문제도 분석하나요?",
    a: (
      <>
        AI 극복법은 아니에요 &mdash; 지난 진단 이후, 최대 {DIAGNOSIS_MAX_WINDOW_DAYS}일치만
        봐요. 다만 개념 그래프는 기간 칩을 <b>전체</b>로 바꾸면 지금까지 쌓인 오답을 전부
        놓고 볼 수 있어요.
      </>
    ),
  },
  {
    q: "진단 화면이 비어 있어요.",
    a: (
      <>
        그 기간에 틀린 문항이 없으면 그래프에 세울 게 없어요. 기간을 넓히거나 과목 칩을
        &lsquo;전체 과목&rsquo;으로 바꿔보세요. 그래도 비어 있다면 아직 채점된 기록이
        부족한 경우예요 &mdash; 오답 {DIAGNOSIS_MIN_WRONG}개 또는 응시{" "}
        {DIAGNOSIS_MIN_ATTEMPTS}회를 넘기면 열려요.
      </>
    ),
  },
  {
    q: "멤버십이 끝나면 진단 기록도 사라지나요?",
    a: (
      <>
        기록은 지워지지 않아요. 잠기는 건 진단 화면이고, 오답노트와 쌓인 기록은 그대로
        남아 다시 시작하면 이어집니다.
      </>
    ),
  },
];

function Faq() {
  return (
    <section className="flex flex-col gap-4">
      <SectionTitle>자주 묻는 질문</SectionTitle>
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
    </section>
  );
}

function FinalCta({ cta }: { cta: Cta }) {
  return (
    <section className="flex flex-col items-center gap-3 rounded-2xl border border-violet-200 bg-violet-50/70 px-5 py-8 text-center dark:border-violet-900/50 dark:bg-violet-950/20">
      <p className="break-keep text-lg font-extrabold text-zinc-900 dark:text-zinc-100">
        이번 주에 무엇부터 잡을지, 하나만 정해요
      </p>
      <p className="max-w-md break-keep text-sm leading-6 text-zinc-600 dark:text-zinc-400">
        진단은 목록을 늘리는 도구가 아니라 순서를 정하는 도구예요. 1위 개념 하나만
        메워도 다음 진단의 그래프가 달라져요.
      </p>
      <CtaButton cta={cta} />
      {cta.note && <p className="text-xs text-zinc-500 dark:text-zinc-500">{cta.note}</p>}
    </section>
  );
}

function SectionTitle({ children, sub }: { children: ReactNode; sub?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">{children}</h2>
      {sub && <p className="break-keep text-sm text-zinc-500 dark:text-zinc-500">{sub}</p>}
    </div>
  );
}

// "2026-08-31" → "8월 31일".
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 오늘(KST)부터 그 날짜까지 남은 일수. 이미 지났으면 0.
function daysUntil(date: string): number {
  const to = Date.parse(`${date}T00:00:00Z`);
  const from = Date.parse(`${kstToday()}T00:00:00Z`);
  if (Number.isNaN(to) || Number.isNaN(from)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}
