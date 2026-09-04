// 홈 진입이 항상 즉시(정적 셸) 이동되는지 빌드가 검증하게 한다. 홈은 검색 파라미터를
// 읽지 않으므로(검색은 /papers) samples 를 따로 선언할 것이 없다.
export const unstable_instant = { prefetch: "static" };

import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  CalendarClock,
  Check,
  Download,
  FileStack,
  FileText,
  Monitor,
  Search,
  Shuffle,
  Timer,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HomePopupSlider } from "@/components/home-popup-slider";
import { getLandingData } from "@/lib/landing-data";
import { examHref } from "@/lib/exam-index";
import {
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MIN_ATTEMPTS,
  DIAGNOSIS_MIN_WRONG,
} from "@/lib/ai-diagnosis";
import { FREE_EXPLANATION_DAILY_PAPERS, FREE_UNTIL_LABEL, TRIAL_DAYS } from "@gongmoa/core";
import type { Metadata } from "next";

// 홈 = 사이트 소개 랜딩.
//
// 원래 홈은 기출문제 전체 목록(검색·필터·카드)이었다. 자료를 찾으러 온 사람에게는
// 최적이었지만, 처음 온 수험생은 이 사이트를 "PDF 자료실"로만 읽고 나갔다 — 온라인
// 응시(CBT)·오답노트·AI 약점 진단이 있다는 사실이 화면 어디에도 없었기 때문이다.
// 그래서 목록은 /papers 로 옮기고(메뉴 "기출문제"), 홈은 딱 두 가지를 말한다:
//   1) 로그인 한 번이면 전부 무료다 (전면 무료 이벤트 / 그 뒤로는 체험 기간)
//   2) 세 번만 풀면 AI 가 내 약점을 개념 단위로 짚어준다
// 재방문자는 메뉴·푸터의 "기출문제"로 곧장 목록에 가고, 홈의 큰 버튼도 목록으로 간다.
//
// 본문은 전부 정적 셸이다 — 로그인 여부를 보는 것은 팝업 슬라이더 하나뿐이고 그건
// Suspense 뒤에서 늦게 온다. 숫자(자료 수·응시 수)와 이벤트 여부는 lib/landing-data 의
// 'use cache' 값이다. 여기 적힌 규칙 숫자(응시 3회·오답 15개·7일·하루 3개)는 손으로
// 쓰지 않고 실제 규칙을 집행하는 상수에서 가져온다 — 화면만 옛 숫자를 광고하면 허위 안내다.
export const metadata: Metadata = {
  // 루트 레이아웃의 template("%s | 공모아")이 붙지 않도록 absolute로 준다.
  title: {
    absolute: "공모아 - 공무원 기출문제 무료 자료실 · 온라인 CBT · AI 약점 진단",
  },
  description:
    "국가직·지방직·경찰·소방 공무원 기출문제를 무료로 열람·다운로드하고 온라인 CBT로 바로 풀어보세요. 틀린 문제는 오답노트에 자동으로 쌓이고, AI가 약점을 개념 단위로 진단합니다.",
  alternates: {
    canonical: "/",
    // 새 문제지 피드(app/rss.xml). 네이버 웹마스터도구에 직접 제출하지만,
    // <link rel="alternate">가 있어야 피드 리더와 다른 수집기도 찾아낸다.
    types: { "application/rss+xml": [{ url: "/rss.xml", title: "공모아 새 기출문제" }] },
  },
  openGraph: { url: "/" },
};

export default async function Home() {
  const { combos, totalCount, latestYear, totalDownloads, totalAttempts, freeForAll } =
    await getLandingData();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-16 px-4 pt-8 pb-16 sm:gap-24 sm:pt-14">
      {/* 홈에 뜰 수 있는 안내(전면 무료 이벤트·개발 중 안내·복습 유도·출석 이벤트
          광고) 슬라이드. 어떤 장이 실릴지는 마운트된 뒤 클라이언트가 정하고, 로그인
          여부만 서버가 넘긴다 — 그 한 값 때문에 홈 전체가 동적이 되지 않도록 Suspense
          뒤로 뺀다. 규칙은 lib/home-popup.ts 참고. */}
      <Suspense fallback={null}>
        <HomePopup />
      </Suspense>

      <Hero
        totalCount={totalCount}
        latestYear={latestYear}
        totalDownloads={totalDownloads}
        totalAttempts={totalAttempts}
        freeForAll={freeForAll}
      />
      <Steps />
      <Features freeForAll={freeForAll} />
      <ExamShortcuts combos={combos} />
      <Faq combos={combos} freeForAll={freeForAll} />
      <FinalCta freeForAll={freeForAll} />
    </div>
  );
}

// 팝업 슬라이더에 넘길 로그인 여부. JWT 로컬 검증(getClaims)이면 충분하다 —
// 이 값으로 여는 것은 안내 팝업뿐이고, 실제 데이터 접근은 각자 RLS 가 검증한다.
async function HomePopup() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const signedIn = !!data?.claims.sub;
  // 출석 광고가 가는 곳: 회원은 출석 현황, 비회원은 가입(로그인 화면으로 보내면
  // 계정이 없는 사람이 막다른 길을 만난다).
  return (
    <HomePopupSlider
      attendanceHref={signedIn ? "/mypage?tab=attendance" : "/signup"}
      signedIn={signedIn}
    />
  );
}

// ── 히어로 ───────────────────────────────────────────────────────────────────
// 왼쪽은 한 문장 + 버튼 하나, 오른쪽은 "풀고 나면 이렇게 된다"를 보여주는 결과
// 화면 예시. 처음 온 사람이 스크롤 없이 이 두 덩어리만 보고도 사이트가 뭘 해주는
// 곳인지 알게 하는 것이 목표다.
function Hero({
  totalCount,
  latestYear,
  totalDownloads,
  totalAttempts,
  freeForAll,
}: {
  totalCount: number;
  latestYear: number | null;
  totalDownloads: number;
  totalAttempts: number;
  freeForAll: boolean;
}) {
  return (
    <section className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr] lg:gap-14">
      <div className="flex flex-col items-start gap-5">
        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
          {freeForAll
            ? `${FREE_UNTIL_LABEL}까지 모든 기능 무료`
            : `가입 후 ${TRIAL_DAYS}일 동안 모든 기능 무료`}
        </span>
        <h1 className="break-keep text-[clamp(1.75rem,7vw,2.5rem)] font-extrabold leading-tight tracking-tight text-zinc-900 sm:text-5xl sm:leading-[1.15] dark:text-zinc-100">
          기출은 풀고,
          <br />
          <span className="text-blue-600 dark:text-blue-400">틀린 이유</span>는 AI가 찾아드려요
        </h1>
        <p className="max-w-lg break-keep text-base leading-7 text-zinc-600 sm:text-lg sm:leading-8 dark:text-zinc-400">
          국가직·지방직·경찰·소방 등 공무원 기출문제{" "}
          <strong className="font-semibold text-zinc-800 dark:text-zinc-200">
            {totalCount.toLocaleString("ko-KR")}건
          </strong>
          을 온라인으로 풀고 바로 채점하세요. 틀린 문제는 오답노트에 자동으로 쌓이고,
          AI가 왜 틀리는지 개념 단위로 진단해 드려요.
        </p>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row">
          <Link
            href="/papers"
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-blue-600 px-6 py-3.5 text-base font-bold text-white shadow-sm shadow-blue-600/25 transition-colors hover:bg-blue-700"
          >
            <Monitor size={18} />
            무료로 모의고사 풀기
            <ArrowRight size={16} aria-hidden />
          </Link>
          <Link
            href="/exams"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-200 px-6 py-3.5 text-base font-semibold text-zinc-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
          >
            <Search size={17} />
            시험별로 찾기
          </Link>
        </div>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          기출문제·정답·PDF 다운로드는 로그인 없이 바로. 온라인 응시는 구글·카카오로
          1초 로그인.
        </p>

        {/* 사회적 증거. 값은 60초 캐시(getHomeStats)라 "실시간"이라고 부르지 않는다. */}
        <dl className="mt-2 grid w-full max-w-md grid-cols-3 gap-3">
          <Stat icon={<FileStack size={16} />} label="기출문제" value={`${totalCount.toLocaleString("ko-KR")}건`} />
          <Stat icon={<Download size={16} />} label="누적 다운로드" value={`${totalDownloads.toLocaleString("ko-KR")}회`} />
          <Stat icon={<Users size={16} />} label="누적 응시" value={`${totalAttempts.toLocaleString("ko-KR")}회`} />
        </dl>
      </div>

      <ResultPreview latestYear={latestYear} />
    </section>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-800">
      <dt className="flex items-center gap-1 text-[11px] font-medium text-zinc-500 dark:text-zinc-500">
        <span className="text-blue-500">{icon}</span>
        {label}
      </dt>
      <dd className="truncate text-sm font-bold tabular-nums text-zinc-900 sm:text-base dark:text-zinc-100">
        {value}
      </dd>
    </div>
  );
}

// CBT 를 마치면 보게 되는 화면을 축약한 그림. 실제 결과 모달(cbt-result-modal.tsx)의
// 세 칸(점수·정답률·풀이시간)과, 그 뒤에 이어지는 두 가지(오답노트 저장·AI 진단
// 자격)를 한 장에 담는다. 숫자는 예시라 aria-hidden 으로 낭독기에서 뺀다 — 낭독기
// 사용자에게는 왼쪽 본문이 같은 내용을 말한다.
function ResultPreview({ latestYear }: { latestYear: number | null }) {
  const attemptsSoFar = DIAGNOSIS_MIN_ATTEMPTS - 1;
  return (
    <div aria-hidden className="relative mx-auto w-full max-w-md select-none lg:max-w-none">
      <div className="absolute -inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-blue-100 via-violet-50 to-transparent blur-2xl dark:from-blue-950/50 dark:via-violet-950/30" />
      <div className="flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-4 shadow-xl shadow-zinc-900/5 sm:p-5 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">9급</span>
            <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">
              {latestYear ? `${latestYear}년 ` : ""}국가직 국어
            </span>
          </div>
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            채점 완료
          </span>
        </div>

        <div className="grid grid-cols-3 gap-2 text-center">
          <PreviewTile label="점수" value="85" unit="점" />
          <PreviewTile label="정답률" value="85" unit="%" />
          <PreviewTile label="풀이 시간" value="17:32" />
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-zinc-50 px-3.5 py-3 dark:bg-zinc-800/60">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-100 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300">
            <BookOpenCheck size={16} />
          </span>
          <div className="min-w-0 text-[13px]">
            <p className="font-bold text-zinc-900 dark:text-zinc-100">
              틀린 3문항이 오답노트에 저장됐어요
            </p>
            <p className="text-zinc-500 dark:text-zinc-400">
              해설을 보고, 잊을 때쯤 다시 풀어요
            </p>
          </div>
        </div>

        <div className="rounded-xl border border-violet-200 bg-violet-50/70 px-3.5 py-3 dark:border-violet-900/60 dark:bg-violet-950/30">
          <div className="flex items-center justify-between text-[13px]">
            <p className="flex items-center gap-1.5 font-bold text-violet-800 dark:text-violet-200">
              <BrainCircuit size={15} />
              AI 약점 진단까지
            </p>
            <p className="font-bold tabular-nums text-violet-700 dark:text-violet-300">
              응시 {attemptsSoFar}/{DIAGNOSIS_MIN_ATTEMPTS}
            </p>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-violet-200/70 dark:bg-violet-900/50">
            <div
              className="h-full rounded-full bg-violet-600"
              style={{ width: `${Math.round((attemptsSoFar / DIAGNOSIS_MIN_ATTEMPTS) * 100)}%` }}
            />
          </div>
          <p className="mt-1.5 text-[11px] text-violet-700/80 dark:text-violet-300/70">
            한 번만 더 풀면 틀리는 이유를 개념별로 알려드려요
          </p>
        </div>
      </div>
    </div>
  );
}

function PreviewTile({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="rounded-xl border border-zinc-100 px-2 py-2.5 dark:border-zinc-800">
      <p className="text-[11px] text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="text-xl font-extrabold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
        {unit && <span className="ml-0.5 text-xs font-semibold text-zinc-500">{unit}</span>}
      </p>
    </div>
  );
}

// ── 3단계 ────────────────────────────────────────────────────────────────────
// 이 사이트에서 일어나는 일의 순서. 각 단계의 조건(로그인·응시 횟수)은 여기서 미리
// 말한다 — 문제지 앞에서 로그인 화면을 만나거나, 진단 버튼이 잠겨 있는 걸 보고 나서야
// 알면 "속았다"가 되고, 미리 알면 "다음에 할 일"이 된다.
function Steps() {
  const steps: { icon: React.ReactNode; title: string; body: string; tag: string }[] = [
    {
      icon: <Timer size={18} />,
      tag: "1단계 · 무료",
      title: "실제 시험처럼 풉니다",
      body: "타이머·OMR·필기 도구가 있는 온라인 CBT. 제출하면 즉시 채점되고 같은 문제지를 다시 풀면 회독이 쌓여요.",
    },
    {
      icon: <BookOpenCheck size={18} />,
      tag: "2단계 · 자동",
      title: "틀린 문제는 오답노트로",
      body: "따로 정리할 필요 없어요. 과목별로 모이고, 여러 번 틀린 문제부터 골라 섞어 풀 수 있어요.",
    },
    {
      icon: <BrainCircuit size={18} />,
      tag: `3단계 · 응시 ${DIAGNOSIS_MIN_ATTEMPTS}회부터`,
      title: "AI가 틀리는 이유를 짚어줘요",
      body: `응시 ${DIAGNOSIS_MIN_ATTEMPTS}회 또는 오답 ${DIAGNOSIS_MIN_WRONG}개가 쌓이면 ${DIAGNOSIS_CYCLE_DAYS}일마다 한 번, 내가 고른 오답을 근거로 약한 개념과 극복 계획을 써 드려요.`,
    },
  ];
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="이렇게 됩니다"
        title="푸는 것부터 진단까지, 세 단계"
        description="따로 입력하거나 정리할 것은 없어요. 풀기만 하면 나머지는 자동으로 이어져요."
      />
      <ol className="grid gap-4 sm:grid-cols-3">
        {steps.map((s, i) => (
          <li
            key={s.title}
            className="relative flex flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <div className="flex items-center justify-between">
              <span
                className={`flex h-9 w-9 items-center justify-center rounded-xl ${
                  i === 2
                    ? "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300"
                    : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
                }`}
              >
                {s.icon}
              </span>
              <span className="text-[11px] font-bold text-zinc-400 dark:text-zinc-500">{s.tag}</span>
            </div>
            <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{s.title}</p>
            <p className="break-keep text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ── 기능 카드 ────────────────────────────────────────────────────────────────
// 메뉴에 있는 기능을 전부 한 화면에 늘어놓는다. 무료/멤버십 표시는 /membership 의
// 비교표(FEATURE_ROWS)와 같은 기준이어야 한다 — 여기서 다르게 말하면 어느 쪽이
// 정본인지 알 수 없게 된다.
function Features({ freeForAll }: { freeForAll: boolean }) {
  const premiumTag = freeForAll ? "지금은 무료" : "멤버십";
  const features: {
    icon: React.ReactNode;
    title: string;
    body: string;
    href: string;
    tag: string;
    tone: "blue" | "violet";
  }[] = [
    {
      icon: <Monitor size={20} />,
      title: "온라인 CBT",
      body: "타이머와 OMR, 필기 도구까지. 전체 문제지로 풀거나 한 문항씩 넘기며 풀어요.",
      href: "/papers",
      tag: "무료",
      tone: "blue",
    },
    {
      icon: <BookOpenCheck size={20} />,
      title: "오답노트",
      body: "채점되는 순간 틀린 문제가 과목별로 모여요. 메모를 남기고 극복 여부를 기록해요.",
      href: "/mypage?tab=wrong-notes",
      tag: "무료",
      tone: "blue",
    },
    {
      icon: <Shuffle size={20} />,
      title: "섞어풀기",
      body: "여러 번 틀린 문제, 최근에 틀린 문제를 먼저 뽑아 한 세트로 다시 풀어요.",
      href: "/mypage?tab=wrong-notes",
      tag: "무료",
      tone: "blue",
    },
    {
      icon: <FileText size={20} />,
      title: "문항별 해설",
      body: `문항마다 왜 그 답인지 풀어 쓴 해설. 무료 회원은 하루 ${FREE_EXPLANATION_DAILY_PAPERS}개 문제지까지 볼 수 있어요.`,
      href: "/papers",
      tag: premiumTag,
      tone: "violet",
    },
    {
      icon: <CalendarClock size={20} />,
      title: "오늘의 복습",
      body: "잊을 때쯤 다시 나오는 간격 반복 일정. 매일 몇 문항만 풀면 오답이 기억으로 굳어요.",
      href: "/mypage?tab=wrong-notes",
      tag: premiumTag,
      tone: "violet",
    },
    {
      icon: <BrainCircuit size={20} />,
      title: "AI 약점 진단",
      body: "틀린 문제가 아니라 틀리는 이유를 개념 단위로. 내 오답을 근거로 극복 계획까지 써 줘요.",
      href: "/diagnosis",
      tag: premiumTag,
      tone: "violet",
    },
  ];
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="기능"
        title="공모아에서 할 수 있는 것"
        description={
          freeForAll
            ? `${FREE_UNTIL_LABEL}까지는 로그인만 하면 멤버십 기능까지 전부 열려 있어요.`
            : `가입하면 ${TRIAL_DAYS}일 동안 멤버십 기능까지 전부 써 볼 수 있어요.`
        }
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((f) => (
          <li key={f.title}>
            <Link
              href={f.href}
              className="group flex h-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/40 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-blue-800 dark:hover:bg-blue-950/20"
            >
              <div className="flex items-center justify-between">
                <span
                  className={`flex h-10 w-10 items-center justify-center rounded-xl ${
                    f.tone === "violet"
                      ? "bg-violet-50 text-violet-600 dark:bg-violet-950/40 dark:text-violet-300"
                      : "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300"
                  }`}
                >
                  {f.icon}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    f.tag === "무료" || freeForAll
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"
                      : "bg-violet-50 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300"
                  }`}
                >
                  {f.tag}
                </span>
              </div>
              <p className="text-base font-bold text-zinc-900 dark:text-zinc-100">{f.title}</p>
              <p className="break-keep text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">{f.body}</p>
              <span className="mt-auto flex items-center gap-1 text-xs font-semibold text-blue-600 opacity-0 transition-opacity group-hover:opacity-100 dark:text-blue-400">
                바로 가기 <ArrowRight size={13} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ── 시험별 바로가기 ──────────────────────────────────────────────────────────
// 검색 목록(/papers)은 클라이언트 필터라 HTML 에 링크가 없다. 홈에서 시험 허브
// (/exams/*)와 과목 허브(/subjects)로 가는 서버 렌더 링크를 깔아 두는 것이 크롤러가
// 문제지 3천여 장까지 내려가는 첫 계단이다 — 사람에게도 "내 시험이 있나"를 한눈에
// 확인하는 자리다.
function ExamShortcuts({ combos }: { combos: { slug: string; label: string; count: number }[] }) {
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading
        eyebrow="자료"
        title="내 시험 기출문제 찾기"
        description="시험을 고르면 연도별 기출문제로, 과목을 고르면 급수별 기출문제로 이어져요."
      />
      <ul className="flex flex-wrap gap-2">
        {combos.map((c) => (
          <li key={c.slug}>
            <Link
              href={examHref(c.slug)}
              className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-3.5 py-1.5 text-sm font-medium text-zinc-700 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
            >
              {c.label}
              <span className="text-xs tabular-nums text-zinc-400 dark:text-zinc-500">
                {c.count.toLocaleString("ko-KR")}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
        <Link href="/subjects" className="text-blue-600 hover:underline dark:text-blue-400">
          과목별 기출문제 →
        </Link>
        <Link href="/papers" className="text-blue-600 hover:underline dark:text-blue-400">
          전체 검색 →
        </Link>
      </div>
    </section>
  );
}

// ── FAQ ──────────────────────────────────────────────────────────────────────
// 처음 온 사람이 버튼을 누르기 전에 마음속으로 묻는 것들. 답은 전부 실제 동작 그대로 —
// 숫자·기간은 상수에서 온다.
function Faq({
  combos,
  freeForAll,
}: {
  combos: { label: string }[];
  freeForAll: boolean;
}) {
  const items: { q: string; a: React.ReactNode }[] = [
    {
      q: "정말 무료인가요?",
      a: freeForAll ? (
        <>
          기출문제·정답·PDF 다운로드·온라인 CBT·오답노트는 언제나 무료예요. 해설
          무제한·오늘의 복습·AI 약점 진단 같은 멤버십 기능도 {FREE_UNTIL_LABEL}까지는
          로그인만 하면 전부 열려요. 결제도 카드 등록도 없어요.
        </>
      ) : (
        <>
          기출문제·정답·PDF 다운로드·온라인 CBT·오답노트는 언제나 무료예요. 해설
          무제한·오늘의 복습·AI 약점 진단 같은 멤버십 기능은 가입 후 {TRIAL_DAYS}일 동안
          무료로 써 볼 수 있어요.
        </>
      ),
    },
    {
      q: "왜 로그인해야 하나요?",
      a: (
        <>
          응시 기록·회독·오답노트를 계정에 저장하려면 누가 풀었는지 알아야 해요. 구글이나
          카카오 계정으로 한 번 누르면 끝이고, 이메일·비밀번호를 따로 만들지 않아요. 문제지를
          보거나 내려받는 데는 로그인이 필요 없어요.
        </>
      ),
    },
    {
      q: "어떤 시험이 있나요?",
      a: <>{combos.map((c) => c.label).join(" · ")}. 새 시험은 시행 후 순차적으로 올라와요.</>,
    },
    {
      q: "AI 약점 진단은 언제 받을 수 있나요?",
      a: (
        <>
          온라인 응시 {DIAGNOSIS_MIN_ATTEMPTS}회 또는 오답 {DIAGNOSIS_MIN_WRONG}개가 쌓이면
          열려요. 최근 {DIAGNOSIS_CYCLE_DAYS}일 안에 틀린 문항을 개념 단위로 다시 세우고,
          {DIAGNOSIS_CYCLE_DAYS}일에 한 번 내가 고른 개념의 극복법을 받아요. 따로 입력할 건
          없어요.
        </>
      ),
    },
  ];
  return (
    <section className="flex flex-col gap-6">
      <SectionHeading eyebrow="궁금한 점" title="자주 묻는 질문" />
      <div className="flex flex-col divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-800 dark:bg-zinc-900">
        {items.map((item) => (
          <details key={item.q} className="group px-5 py-4">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-bold text-zinc-900 [&::-webkit-details-marker]:hidden dark:text-zinc-100">
              {item.q}
              <span className="shrink-0 text-zinc-400 transition-transform group-open:rotate-90">
                <ArrowRight size={16} />
              </span>
            </summary>
            <p className="mt-3 break-keep text-[13px] leading-6 text-zinc-600 dark:text-zinc-400">
              {item.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}

// ── 마무리 CTA ───────────────────────────────────────────────────────────────
function FinalCta({ freeForAll }: { freeForAll: boolean }) {
  const perks = [
    "온라인 CBT · 즉시 채점",
    "오답노트 자동 저장",
    `응시 ${DIAGNOSIS_MIN_ATTEMPTS}회부터 AI 약점 진단`,
  ];
  return (
    <section className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 px-6 py-10 text-white shadow-lg shadow-indigo-500/20 sm:px-10 sm:py-14">
      <div className="flex flex-col items-start gap-5">
        <h2 className="break-keep text-2xl font-extrabold leading-tight sm:text-3xl">
          오늘 한 회차만 풀어 보세요
        </h2>
        <ul className="flex flex-col gap-1.5 text-sm text-white/90 sm:flex-row sm:flex-wrap sm:gap-x-6">
          {perks.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <Check size={15} className="shrink-0" />
              {p}
            </li>
          ))}
        </ul>
        <Link
          href="/papers"
          className="inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3.5 text-base font-bold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
        >
          무료로 시작하기
          <ArrowRight size={16} aria-hidden />
        </Link>
        <p className="text-xs text-white/70">
          {freeForAll
            ? `${FREE_UNTIL_LABEL}까지 결제 없이 모든 기능을 쓸 수 있어요.`
            : `가입 후 ${TRIAL_DAYS}일 동안 결제 없이 모든 기능을 쓸 수 있어요.`}
        </p>
      </div>
    </section>
  );
}

function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-bold tracking-wide text-blue-600 dark:text-blue-400">{eyebrow}</p>
      <h2 className="break-keep text-2xl font-extrabold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-100">
        {title}
      </h2>
      {description && (
        <p className="max-w-2xl break-keep text-sm leading-6 text-zinc-600 sm:text-base dark:text-zinc-400">
          {description}
        </p>
      )}
    </div>
  );
}
