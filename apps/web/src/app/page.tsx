// 홈 진입이 항상 즉시(정적 셸) 이동되는지 빌드가 검증하게 한다. 홈은 검색 파라미터를
// 읽지 않으므로(검색은 /papers) samples 를 따로 선언할 것이 없다.
export const unstable_instant = { prefetch: "static" };

import { Suspense } from "react";
import Link from "next/link";
import {
  ArrowRight,
  BrainCircuit,
  Check,
  ChevronRight,
  Flame,
  Search,
  Sparkles,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { HomePopupSlider } from "@/components/home-popup-slider";
import { getLandingData } from "@/lib/landing-data";
import { examHref, type ExamCombo } from "@/lib/exam-index";
import {
  DIAGNOSIS_CYCLE_DAYS,
  DIAGNOSIS_MIN_ATTEMPTS,
  getDiagnosisEligibility,
} from "@/lib/ai-diagnosis";
import { computeDiagnosisProgress } from "@/lib/diagnosis-progress";
import { computeStreakDays } from "@/lib/streak";
import { FREE_UNTIL_LABEL, TRIAL_DAYS, kstDateKey } from "@gongmoa/core";
import type { Metadata } from "next";

// 홈 = 사이트 소개 랜딩.
//
// 원래 홈은 기출문제 전체 목록(검색·필터·카드)이었다. 자료를 찾으러 온 사람에게는
// 최적이었지만, 처음 온 수험생은 이 사이트를 "PDF 자료실"로만 읽고 나갔다 — 온라인
// 응시(CBT)·오답노트·AI 약점 진단이 있다는 사실이 화면 어디에도 없었기 때문이다.
// 그래서 목록은 /papers 로 옮기고(메뉴 "기출문제"), 홈은 위에서 아래로 이렇게 말한다:
//   히어로(한 문장 + 오늘의 학습 현황 예시) → 기출문제 찾기(검색창 + 시험별 카드)
//   → AI 약점 진단(짙은 판 + 약점 리포트 예시) → 마무리 CTA
// 재방문자는 메뉴·푸터의 "기출문제"로 곧장 목록에 가고, 홈의 큰 버튼도 목록으로 간다.
//
// 본문은 전부 정적 셸이다 — 로그인 여부를 보는 것은 팝업 슬라이더 하나뿐이고 그건
// Suspense 뒤에서 늦게 온다. 숫자(자료 수)와 이벤트 여부는 lib/landing-data 의
// 'use cache' 값이다. 여기 적힌 규칙 숫자(응시 3회·오답 15개·7일)는 손으로 쓰지 않고
// 실제 규칙을 집행하는 상수에서 가져온다 — 화면만 옛 숫자를 광고하면 허위 안내다.
//
// 색은 이 페이지만의 팔레트를 쓴다(남색 primary + 초록 accent). 사이트의 파랑과 다른
// 이유는 홈이 "제품 소개"라 나머지 화면(도구)과 톤을 달리 가져가려는 것 — 값은 아래
// 상수 둘에 모아 두었다. hover 는 인라인 스타일로 색을 못 바꾸므로 투명도·이동만 준다.
const NAVY = "#012854";
const ACCENT = "#12b382";

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
  const { combos, freeForAll } = await getLandingData();

  return (
    <div className="flex flex-col">
      {/* 홈에 뜰 수 있는 안내(전면 무료 이벤트·개발 중 안내·복습 유도·출석 이벤트
          광고) 슬라이드. 어떤 장이 실릴지는 마운트된 뒤 클라이언트가 정하고, 로그인
          여부만 서버가 넘긴다 — 그 한 값 때문에 홈 전체가 동적이 되지 않도록 Suspense
          뒤로 뺀다. 규칙은 lib/home-popup.ts 참고. */}
      <Suspense fallback={null}>
        <HomePopup />
      </Suspense>

      <TopBanner freeForAll={freeForAll} />
      <Hero />
      <PastQuestions combos={combos} />
      <Diagnosis />
      <ClosingCta freeForAll={freeForAll} />
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

// ── 상단 띠 ──────────────────────────────────────────────────────────────────
// 지금 이 사이트에 온 사람이 가장 먼저 알아야 할 한 줄. 이벤트 중에는 "전부 무료",
// 끝난 뒤에는 체험 기간을 말한다 — 날짜·기간은 core 상수에서 온다.
function TopBanner({ freeForAll }: { freeForAll: boolean }) {
  return (
    <div className="border-b border-zinc-200 bg-[#e7f2fc]/60 text-center text-xs font-medium text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
      <Link
        href="/membership"
        className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2 hover:text-zinc-900 dark:hover:text-zinc-200"
      >
        <span className="size-1.5 rounded-full" style={{ backgroundColor: ACCENT }} />
        {freeForAll
          ? `${FREE_UNTIL_LABEL}까지 멤버십 전 기능 무료, 로그인만 하면 돼요`
          : `가입하면 ${TRIAL_DAYS}일 동안 멤버십 전 기능 무료`}
        <ChevronRight size={14} aria-hidden />
      </Link>
    </div>
  );
}

// ── 히어로 ───────────────────────────────────────────────────────────────────
function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-zinc-200 bg-[#e7f2fc]/45 dark:border-zinc-800 dark:bg-zinc-900/60">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 lg:grid-cols-[1.08fr_.92fr] lg:px-6 lg:py-24">
        {/* lg 미만에서는 카드가 아래로 내려가 한 열이 되므로 글도 가운데로 모은다 —
            왼쪽 정렬 글 + 가운데 카드가 세로로 쌓이면 화면이 한쪽으로 쏠려 보인다. */}
        <div className="relative z-10 flex flex-col items-center text-center lg:items-start lg:text-left">
          <div
            className="mb-6 inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1.5 text-xs font-bold dark:bg-zinc-950"
            style={{ borderColor: `${ACCENT}40`, color: ACCENT }}
          >
            <Sparkles size={14} aria-hidden />
            수험생을 위한 가장 똑똑한 공부법
          </div>
          <h1 className="max-w-xl text-balance text-4xl font-bold leading-[1.15] tracking-[-0.04em] text-zinc-900 sm:text-5xl lg:text-6xl dark:text-zinc-50">
            합격에 필요한 모든 것,
            <br />
            <span style={{ color: ACCENT }}>공모아</span>에서 시작하세요.
          </h1>
          <p className="mt-6 max-w-lg text-pretty text-base leading-7 text-zinc-600 sm:text-lg dark:text-zinc-400">
            공무원 기출문제를 온라인으로 풀고 바로 채점하세요.
            <br />
            틀린 문제는 오답노트에 자동으로 쌓이고, AI가 왜 틀리는지 개념 단위로 진단해
            드립니다.
          </p>
          <div className="mt-9 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
            <Link
              href="/papers"
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#012854] px-5 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#012854]/15 transition-transform hover:-translate-y-0.5 dark:bg-[#0a7d5b] dark:shadow-black/30"
            >
              기출문제 풀러가기
              <ArrowRight size={16} aria-hidden />
            </Link>
            <Link
              href="/diagnosis"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-5 py-3.5 text-sm font-bold text-zinc-900 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-800"
            >
              AI 약점진단 알아보기
            </Link>
          </div>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-zinc-500 lg:justify-start dark:text-zinc-500">
            <span className="flex items-center gap-1.5">
              <Check size={14} style={{ color: ACCENT }} aria-hidden />
              무료로 시작
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} style={{ color: ACCENT }} aria-hidden />
              기출·정답은 로그인 없이 열람
            </span>
            <span className="flex items-center gap-1.5">
              <Check size={14} style={{ color: ACCENT }} aria-hidden />
              구글·카카오 1초 로그인
            </span>
          </div>
        </div>

        {/* 회원이면 진짜 내 숫자, 아니면 예시. 조회는 Suspense 뒤에서 — 정적 셸에는
            뼈대(스켈레톤)가 들어간다. 여기에 예시 카드를 두면 로그인한 사람도 남의
            숫자를("예시 화면" 표시까지) 1초쯤 보고 나서야 제 숫자로 바뀐다. */}
        <Suspense fallback={<TodayStudyCardSkeleton />}>
          <TodayStudy />
        </Suspense>
      </div>
    </section>
  );
}

// ── 오늘의 학습 현황 카드 ─────────────────────────────────────────────────
// 비회원에게는 "풀고 나면 이렇게 쌓인다"를 보여주는 예시(예시 화면 표기), 회원에게는
// 진짜 내 숫자다 — 마이페이지 요약(응시·연속 학습)과 AI 진단 자격(응시 N/3)을 한 장에
// 담는다. 로그인 여부와 조회는 Suspense 뒤(TodayStudy)에서 하고, 정적 셸에는 같은
// 크기의 뼈대(TodayStudyCardSkeleton)가 들어간다 — 도착하면 자리 이동 없이 내용만
// 채워지고, 예시 숫자가 회원에게 잠깐 비치는 일도 없다.
type TodayStudyData = {
  todayAttempts: number;
  // 전체 응시의 정답률(%). 응시가 없으면 null.
  accuracyPct: number | null;
  streakDays: number;
  // 이번 주 월~일, 그날 푼 문항 수. 막대 높이는 이 배열의 최댓값 기준.
  week: number[];
  // 0=월 … 6=일 (KST)
  todayIndex: number;
  attemptCount: number;
  wrongCount: number;
};

const SAMPLE_TODAY_STUDY: TodayStudyData = {
  todayAttempts: 2,
  accuracyPct: 84,
  streakDays: 7,
  week: [38, 55, 46, 72, 61, 88, 24],
  todayIndex: 5,
  attemptCount: DIAGNOSIS_MIN_ATTEMPTS - 1,
  wrongCount: 5,
};

async function TodayStudy() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims.sub;
  if (!userId) return <TodayStudyCard data={SAMPLE_TODAY_STUDY} sample />;

  // 본인 응시만 돌아온다(RLS). 마이페이지가 같은 표를 통째로 읽으므로 양은 같은 수준.
  const [{ data: rows }, eligibility] = await Promise.all([
    supabase
      .from("cbt_attempts")
      .select("score, total_questions, created_at")
      .eq("user_id", userId),
    getDiagnosisEligibility(supabase, userId),
  ]);
  const attempts = (rows ?? []) as { score: number; total_questions: number; created_at: string }[];

  const now = new Date();
  const todayKey = kstDateKey(now);
  // 이번 주 월요일(KST)부터 7일의 날짜 키. kstDateKey 는 "YYYY-MM-DD" 라 UTC 자정으로
  // 파싱해 요일을 구해도 어긋나지 않는다.
  const todayUtc = new Date(`${todayKey}T00:00:00Z`);
  const mondayOffset = (todayUtc.getUTCDay() + 6) % 7;
  const weekKeys = Array.from({ length: 7 }, (_, i) =>
    new Date(todayUtc.getTime() + (i - mondayOffset) * 86_400_000).toISOString().slice(0, 10),
  );
  const week = weekKeys.map(() => 0);
  let todayAttempts = 0;
  let score = 0;
  let total = 0;
  for (const a of attempts) {
    const key = kstDateKey(new Date(a.created_at));
    if (key === todayKey) todayAttempts++;
    const i = weekKeys.indexOf(key);
    if (i >= 0) week[i] += a.total_questions ?? 0;
    score += a.score ?? 0;
    total += a.total_questions ?? 0;
  }

  return (
    <TodayStudyCard
      data={{
        todayAttempts,
        accuracyPct: total > 0 ? Math.round((score / total) * 100) : null,
        streakDays: computeStreakDays(attempts.map((a) => a.created_at)),
        week,
        todayIndex: mondayOffset,
        attemptCount: eligibility.attemptCount,
        wrongCount: eligibility.wrongCount,
      }}
    />
  );
}

// 카드가 도착하기 전 자리를 잡아 두는 뼈대. 아래 TodayStudyCard 와 바깥 상자·여백·
// 글자 크기를 그대로 맞춰야 도착하는 순간 화면이 밀리지 않는다 (빈 칸 높이는 자리를
// 대신하는 글자의 줄 높이와 같게: text-xs=h-4, text-xl=h-7). 제목처럼 누구에게나 같은
// 글자는 그대로 두고, 사람마다 다른 값(숫자·막대·진단 문구)만 회색 칸으로 비워 둔다.
function TodayStudyCardSkeleton() {
  const days = ["월", "화", "수", "목", "금", "토", "일"];
  const box = "rounded bg-zinc-200 dark:bg-zinc-800";
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
        style={{ boxShadow: `0 20px 25px -5px ${NAVY}1a` }}
      >
        <div className="animate-pulse" aria-hidden>
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-xs font-bold" style={{ color: ACCENT }}>
                TODAY&apos;S STUDY
              </p>
              <h2 className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
                오늘의 학습 현황
              </h2>
            </div>
            <div className={`size-10 rounded-full ${box}`} />
          </div>

          <div className="grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="rounded-xl bg-[#e7f2fc] p-3 dark:bg-zinc-800/70">
                <div className={`h-4 w-12 ${box}`} />
                <div className={`mt-2 h-7 w-14 ${box}`} />
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="mb-3 flex justify-between">
              <div className={`h-4 w-20 ${box}`} />
              <div className={`h-4 w-12 ${box}`} />
            </div>
            <div className="flex h-24 gap-2">
              {days.map((d) => (
                <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                  <div
                    className="w-full rounded-t bg-zinc-200 dark:bg-zinc-800"
                    style={{ height: "36%" }}
                  />
                  <span className="text-[10px] leading-none text-zinc-400">{d}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            className="mt-4 flex items-center gap-3 rounded-xl p-3"
            style={{ backgroundColor: `${ACCENT}1a` }}
          >
            <div className={`size-9 shrink-0 rounded-lg ${box}`} />
            <div className="min-w-0 flex-1">
              <div className={`h-4 w-32 max-w-full ${box}`} />
              <div className={`mt-0.5 h-4 w-44 max-w-full ${box}`} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function TodayStudyCard({ data, sample = false }: { data: TodayStudyData; sample?: boolean }) {
  const days = ["월", "화", "수", "목", "금", "토", "일"];
  const weekMax = Math.max(1, ...data.week);
  const weekTotal = data.week.reduce((a, b) => a + b, 0);
  const progress = computeDiagnosisProgress({
    attemptCount: data.attemptCount,
    wrongCount: data.wrongCount,
  });
  return (
    <div
      aria-hidden={sample || undefined}
      className="relative mx-auto w-full max-w-md lg:max-w-none"
    >
      <div
        className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-xl sm:p-6 dark:border-zinc-800 dark:bg-zinc-950"
        style={{ boxShadow: `0 20px 25px -5px ${NAVY}1a` }}
      >
        <div className="mb-5 flex items-center justify-between">
          <div>
            <p className="text-xs font-bold" style={{ color: ACCENT }}>
              TODAY&apos;S STUDY
            </p>
            <h2 className="mt-1 text-lg font-bold text-zinc-900 dark:text-zinc-100">
              오늘의 학습 현황
            </h2>
          </div>
          {sample ? (
            <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-bold text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
              예시 화면
            </span>
          ) : (
            <Link
              href="/mypage"
              className="grid size-10 place-items-center rounded-full bg-[#e7f2fc] text-zinc-700 transition-colors hover:bg-[#d3e8f8] dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
              aria-label="마이페이지"
            >
              <Flame size={18} />
            </Link>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <MiniStat label="오늘 응시" value={String(data.todayAttempts)} unit="회차" />
          <MiniStat
            label="정답률"
            value={data.accuracyPct == null ? "–" : String(data.accuracyPct)}
            unit={data.accuracyPct == null ? "" : "%"}
            accent
          />
          <MiniStat label="연속 학습" value={String(data.streakDays)} unit="일" />
        </div>

        <div className="mt-5 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="mb-3 flex justify-between text-xs">
            <span className="font-semibold text-zinc-900 dark:text-zinc-100">이번 주 학습량</span>
            <span className="tabular-nums text-zinc-500">{weekTotal.toLocaleString("ko-KR")}문제</span>
          </div>
          {/* 막대 높이는 퍼센트다 — 퍼센트 높이는 부모 높이가 확정돼 있어야 풀리므로
              열마다 h-full 을 주고 아래 정렬(justify-end)로 바닥에 붙인다. 열에 높이가
              없으면 막대가 0 으로 사라진다(실측). 0 인 날도 바닥선이 보이게 최소 4%. */}
          <div className="flex h-24 gap-2">
            {days.map((d, i) => (
              <div key={d} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <div
                  className="w-full rounded-t"
                  style={{
                    height: `${Math.max(4, Math.round((data.week[i] / weekMax) * 88))}%`,
                    backgroundColor: i === data.todayIndex ? ACCENT : `${NAVY}26`,
                  }}
                />
                <span className="text-[10px] leading-none text-zinc-500">{d}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 진단까지 남은 거리 또는 "받기". 회원에게는 실제 링크, 예시에서는 그림. */}
        <DiagnosisRow
          progress={progress}
          href={sample ? undefined : progress.eligible ? "/mypage/diagnosis" : "/papers"}
        />
      </div>
    </div>
  );
}

function DiagnosisRow({
  progress,
  href,
}: {
  progress: ReturnType<typeof computeDiagnosisProgress>;
  href?: string;
}) {
  const body = (
    <>
      <div
        className="grid size-9 shrink-0 place-items-center rounded-lg text-white"
        style={{ backgroundColor: ACCENT }}
      >
        <BrainCircuit size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-bold text-zinc-900 dark:text-zinc-100">
          {progress.eligible ? "AI 약점 진단 받기" : `AI 약점 진단까지 ${progress.label}`}
        </p>
        <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
          {progress.eligible
            ? "틀리는 이유를 개념별로 짚어 드려요"
            : (progress.remainingHint ?? "").replace("진단이 열려요", "틀리는 이유를 개념별로 알려드려요")}
        </p>
      </div>
      <ChevronRight size={16} className="shrink-0 text-zinc-400" />
    </>
  );
  const cls = "mt-4 flex items-center gap-3 rounded-xl p-3";
  const style = { backgroundColor: `${ACCENT}1a` };
  return href ? (
    <Link href={href} prefetch={false} className={`${cls} transition-opacity hover:opacity-90`} style={style}>
      {body}
    </Link>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

function MiniStat({
  label,
  value,
  unit,
  accent = false,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl bg-[#e7f2fc] p-3 dark:bg-zinc-800/70">
      <p className="text-xs text-zinc-500 dark:text-zinc-400">{label}</p>
      <p
        className="mt-2 text-xl font-bold tabular-nums text-zinc-900 dark:text-zinc-100"
        style={accent ? { color: ACCENT } : undefined}
      >
        {value}
        <span className="ml-0.5 text-xs font-medium">{unit}</span>
      </p>
    </div>
  );
}

// ── 기출문제 찾기 ────────────────────────────────────────────────────────────
// 검색창은 자바스크립트 없이도 동작하는 GET 폼이다 — /papers 가 ?q= 를 읽어 그
// 검색어로 목록을 연다. 그 아래 카드는 시험(시행처+급수) 허브(/exams/*)로 가는
// 서버 렌더 링크라 크롤러가 문제지 3천여 장까지 내려가는 첫 계단이기도 하다.
//
// 여섯 장은 고정이다(응시 인원이 많은 순이 아니라 "처음 온 사람이 찾는 순"): 지방직·
// 국가직 9급이 절대다수, 그다음 7급, 경찰·소방은 시행처 자체가 시험명, 법원직은 별도
// 과목 체계라 따로 찾는다. 건수·연도만 실제 색인(getExamIndex)에서 채우고, 색인에
// 없는 시험(자료가 아직 없을 때)은 카드를 그리지 않는다 — 빈 페이지로 보내지 않는다.
// 배지 색: 경찰은 제복의 청색, 소방은 적색. 나머지는 홈 팔레트에서 골랐다.
const FEATURED_EXAMS: { slug: string; badge: string; color: string }[] = [
  { slug: "지방직-9급", badge: "9급", color: ACCENT },
  { slug: "국가직-9급", badge: "9급", color: NAVY },
  { slug: "국가직-7급", badge: "7급", color: "#5b21b6" },
  { slug: "경찰", badge: "경찰", color: "#1d4ed8" },
  { slug: "소방", badge: "소방", color: "#dc2626" },
  { slug: "법원직-9급", badge: "9급", color: "#92400e" },
];

function PastQuestions({ combos }: { combos: ExamCombo[] }) {
  const bySlug = new Map(combos.map((c) => [c.slug, c]));
  const featured = FEATURED_EXAMS.flatMap((f) => {
    const combo = bySlug.get(f.slug);
    return combo ? [{ ...f, combo }] : [];
  });
  return (
    <section id="problems" className="mx-auto w-full max-w-6xl px-4 py-16 lg:px-6 lg:py-20">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-sm font-bold" style={{ color: ACCENT }}>
            PAST QUESTIONS
          </p>
          <h2 className="mt-2 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl dark:text-zinc-50">
            원하는 기출문제를 찾아보세요
          </h2>
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            국가직·지방직·경찰·소방 등 공무원 시험 기출문제를 한 곳에서
          </p>
        </div>
        <Link
          href="/papers"
          className="flex items-center gap-1 text-sm font-bold text-[#012854] hover:underline dark:text-emerald-300"
        >
          전체 기출문제 보기
          <ArrowRight size={14} aria-hidden />
        </Link>
      </div>

      <form
        action="/papers"
        method="get"
        role="search"
        className="mt-8 flex items-center rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        <Search size={18} className="ml-2.5 shrink-0 text-zinc-400" aria-hidden />
        <input
          type="search"
          name="q"
          placeholder="예: 2025 국가직 행정법, 9급 국어"
          aria-label="기출문제 검색"
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 dark:text-zinc-100"
        />
        <button
          type="submit"
          className="rounded-lg bg-[#012854] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#0a3a72] dark:bg-[#0a7d5b] dark:hover:bg-[#096b4e]"
        >
          검색
        </button>
      </form>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {featured.map(({ slug, badge, color, combo: c }) => (
          <Link
            key={slug}
            href={examHref(c.slug)}
            className="group flex items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 transition-all hover:-translate-y-0.5 hover:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
          >
            <span
              className="grid size-11 shrink-0 place-items-center rounded-lg text-sm font-bold text-white shadow-sm"
              style={{ backgroundColor: color, boxShadow: `0 4px 10px -2px ${color}66` }}
            >
              {badge}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-zinc-900 dark:text-zinc-100">{c.label}</p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                기출문제 {c.count.toLocaleString("ko-KR")}개 ·{" "}
                {c.years[c.years.length - 1]}~{c.years[0]}년
              </p>
            </div>
            <ChevronRight
              size={16}
              className="shrink-0 text-zinc-300 transition-colors group-hover:text-zinc-500"
              aria-hidden
            />
          </Link>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-semibold">
        <Link href="/exams" className="text-[#012854] hover:underline dark:text-emerald-300">
          시험별 전체 보기 →
        </Link>
        <Link href="/subjects" className="text-[#012854] hover:underline dark:text-emerald-300">
          과목별 기출문제 →
        </Link>
      </div>
    </section>
  );
}

// ── AI 약점 진단 ─────────────────────────────────────────────────────────────
function Diagnosis() {
  return (
    <section
      id="diagnosis"
      className="border-y border-zinc-200 text-white dark:border-zinc-800"
      style={{ backgroundColor: NAVY }}
    >
      <div className="mx-auto grid max-w-6xl items-center gap-10 px-4 py-14 lg:grid-cols-[1fr_.75fr] lg:px-6 lg:py-16">
        <div>
          <p className="text-sm font-bold" style={{ color: ACCENT }}>
            AI WEAKNESS DIAGNOSIS
          </p>
          <h2 className="mt-3 max-w-lg text-[1.625rem] font-bold leading-tight tracking-tight sm:text-4xl">
            열심히만 하지 마세요.
            <br />
            약점을 알면 합격이 빨라집니다.
          </h2>
          <p className="mt-5 max-w-lg text-sm leading-6 text-white/70">
            온라인 응시와 복습에서 틀린 문항을 AI가 개념 단위로 다시 세우고, 내가 고른
            오답 하나하나를 근거로 &ldquo;왜 그렇게 골랐는지 · 그래서 뭘 하면 되는지&rdquo;를
            써 드립니다.
          </p>
          <Link
            href="/diagnosis"
            className="mt-7 inline-flex items-center gap-2 rounded-lg px-5 py-3.5 text-sm font-bold text-white transition-opacity hover:opacity-90"
            style={{ backgroundColor: ACCENT }}
          >
            무료로 진단 시작하기
            <ArrowRight size={16} aria-hidden />
          </Link>
        </div>

        <WeaknessReportCard />
      </div>
    </section>
  );
}

// 진단 결과의 "취약 개념" 부분을 축약한 예시. 실제 리포트(mypage/diagnosis)는 개념마다
// 내 정답률·출제 빈도·추세를 보여주고, 고른 개념에 극복 계획을 붙여 준다. 개념 이름은
// 개념 사전에 있는 실제 축(과목 · keyword_title)의 모양을 따랐다. 숫자는 예시.
function WeaknessReportCard() {
  const rows: { subject: string; concept: string; note: string; pct: number; weak: boolean }[] =
    [
      { subject: "행정법총론", concept: "행정행위의 효력", note: "주의 필요", pct: 38, weak: true },
      { subject: "영어", concept: "어휘·숙어", note: "보완 중", pct: 58, weak: false },
      { subject: "국어", concept: "문법", note: "안정적", pct: 82, weak: false },
    ];
  return (
    <div aria-hidden className="relative rounded-2xl border border-white/15 bg-white/5 p-5">
      {/* 예시임을 카드 위에 박아 둔다 — 실제 내 리포트로 오해하고 "내 과목이 아닌데"
          하며 나가는 일이 없게. */}
      <span className="absolute right-4 top-4 rounded-full border border-white/25 bg-white/10 px-2 py-0.5 text-[10px] font-bold tracking-wide text-white/80">
        예시 화면
      </span>
      <div className="flex items-center gap-3 border-b border-white/10 pb-4 pr-16">
        <div
          className="grid size-10 place-items-center rounded-xl text-white"
          style={{ backgroundColor: ACCENT }}
        >
          <BrainCircuit size={18} />
        </div>
        <div>
          <p className="text-sm font-bold">나의 약점 리포트</p>
          <p className="text-xs text-white/55">최근 {DIAGNOSIS_CYCLE_DAYS}일 오답 기준 · 개념별 정답률</p>
        </div>
      </div>
      <div className="flex flex-col gap-4 pt-5">
        {rows.map((r) => (
          <div key={r.concept} className="flex items-center gap-3">
            <div className="w-20 shrink-0 text-xs text-white/70">{r.subject}</div>
            <div className="flex-1">
              <div className="mb-1.5 flex justify-between text-[11px]">
                <span className="font-medium">{r.concept}</span>
                <span className="text-white/50">{r.note}</span>
              </div>
              <div className="h-2 rounded-full bg-white/10">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${r.pct}%`,
                    backgroundColor: r.weak ? ACCENT : "rgba(255,255,255,0.5)",
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-5 border-t border-white/10 pt-4 text-[11px] leading-5 text-white/55">
        고른 개념마다 원인 · 극복 계획 · 시험장 체크리스트를 써 주고, 같은 개념 기출 5문제를
        그 자리에서 풀 수 있어요.
      </p>
    </div>
  );
}

// ── 마무리 ───────────────────────────────────────────────────────────────────
function ClosingCta({ freeForAll }: { freeForAll: boolean }) {
  return (
    <section className="bg-[#e7f2fc]/40 dark:bg-zinc-900/60">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-4 py-14 text-center lg:px-6">
        <h2 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          공모아에서 합격을 준비하세요
        </h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          {freeForAll
            ? `${FREE_UNTIL_LABEL}까지 결제 없이 모든 기능을 쓸 수 있어요.`
            : `가입 후 ${TRIAL_DAYS}일 동안 결제 없이 모든 기능을 쓸 수 있어요.`}
        </p>
        <Link
          href="/papers"
          className="mt-6 inline-flex items-center gap-2 rounded-lg bg-[#012854] px-6 py-3.5 text-sm font-bold text-white shadow-lg shadow-[#012854]/15 transition-transform hover:-translate-y-0.5 dark:bg-[#0a7d5b] dark:shadow-black/30"
        >
          무료로 시작하기
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
    </section>
  );
}
