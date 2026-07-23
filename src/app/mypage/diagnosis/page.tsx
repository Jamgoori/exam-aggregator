import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Sparkles,
  TrendingDown,
  TrendingUp,
  Minus,
  Target,
  Flame,
  AlertTriangle,
  BookOpen,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getTodayDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  type AiDiagnosisReport,
  type DiagnosisWeakConcept,
  type DiagnosisSubjectTrend,
  type DiagnosisMission,
} from "@/lib/ai-diagnosis";
import { SolveButton } from "./diagnosis-actions";

// AI 약점 진단 대시보드. 데이터 나열이 아니라 "지금 뭘 하면 되는지"를 위에서부터
// 순서대로 제시한다: A) 오늘의 1분 미션 → B) 최우선 취약 개념 Top 3 → C) 오답 패턴
// 인사이트 → D) 과목별 성적 추이. 오늘 리포트가 있으면 그걸, 없고 지난 리포트가 있으면
// 그걸 보여준다. 아직 아무것도 없으면 상태에 맞는 안내.
export default async function DiagnosisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent("/mypage/diagnosis")}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const today = await getTodayDiagnosis(supabase, user.id);
  let report: AiDiagnosisReport | null = today?.report ?? null;
  let date = today?.date ?? null;
  let stale = false;

  if (!report) {
    const latest = await getLatestReadyDiagnosis(supabase, user.id);
    if (latest) {
      report = latest.report;
      date = latest.date;
      stale = true;
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 pb-16 pt-6 sm:pt-8">
        <header className="flex flex-col gap-1.5">
          <Link
            href="/mypage?tab=wrong-notes"
            className="text-sm text-slate-500 transition-colors hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
          >
            ← 오답노트로
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900 dark:text-zinc-100">
            <Sparkles size={22} className="text-blue-600 dark:text-blue-400" />
            AI 약점 진단
          </h1>
          {date && (
            <p className="text-xs text-slate-500 dark:text-zinc-500">
              {date} 기준{stale ? " · 오늘 진단은 준비되면 여기 표시돼요" : ""}
            </p>
          )}
        </header>

        {!report ? (
          <EmptyState supabase={supabase} userId={user.id} pending={today?.status === "pending"} />
        ) : (
          <Dashboard report={report} />
        )}
      </div>
    </div>
  );
}

// 카드 셸: 배경(slate-50) 위 화이트 라운드 카드 + 은은한 그림자.
function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </section>
  );
}

function Dashboard({ report }: { report: AiDiagnosisReport }) {
  const mission = resolveMission(report);
  const concepts = (report.weakConcepts ?? []).slice(0, 3);
  const insights = report.insights ?? [];
  const trends = report.subjectTrends ?? [];

  return (
    <div className="flex flex-col gap-6">
      {/* A. 오늘의 1분 요약 & 미션 */}
      <HeroMission mission={mission} summary={report.summary} />

      {/* B. 최우선 극복 취약 개념 Top 3 */}
      {concepts.length > 0 && (
        <div className="flex flex-col gap-3">
          <SectionTitle icon={<Flame size={16} className="text-blue-600 dark:text-blue-400" />}>
            최우선 극복 취약 개념 Top {concepts.length}
          </SectionTitle>
          {concepts.map((c, i) => (
            <ConceptCard key={`${c.concept}-${i}`} concept={c} rank={i + 1} />
          ))}
        </div>
      )}

      {/* C. AI 오답 패턴 분석 */}
      {insights.length > 0 && <InsightCard insights={insights} />}

      {/* D. 과목별 성적 추이 */}
      {trends.length > 0 && <TrendsCard trends={trends} />}

      <p className="px-1 text-center text-xs text-slate-400 dark:text-zinc-600">
        진단은 하루 1회예요. 오답노트 상단의 &lsquo;진단 받기&rsquo;로 새로 요청할 수 있어요.
      </p>
    </div>
  );
}

function SectionTitle({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 px-1 text-sm font-bold text-slate-700 dark:text-zinc-300">
      {icon}
      {children}
    </h2>
  );
}

/* ---------------- A. Hero ---------------- */

function HeroMission({ mission, summary }: { mission: DiagnosisMission | null; summary: string }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-600 to-blue-500 p-5 text-white shadow-sm dark:border-blue-900/40">
      <p className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-blue-100">
        <Target size={14} /> 오늘의 1분 미션
      </p>
      <p className="mt-2 text-lg font-bold leading-snug">
        {mission?.headline ?? summary.split(/(?<=[.!?])\s/)[0] ?? "오늘의 약점을 하나씩 잡아봐요."}
      </p>
      {summary && mission?.headline && (
        <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-blue-50/90">{summary}</p>
      )}
      <div className="mt-4">
        {mission?.subjectSlug ? (
          <SolveButton
            subjectSlug={mission.subjectSlug}
            limit={5}
            label="오늘의 맞춤 미션 시작하기"
            variant="hero"
            className="!bg-white !text-blue-700 hover:!bg-blue-50"
          />
        ) : (
          <Link
            href="/mypage?tab=wrong-notes"
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-5 py-3.5 text-base font-bold text-blue-700 shadow-sm transition-colors hover:bg-blue-50"
          >
            오답노트에서 미션 고르기 <span aria-hidden>→</span>
          </Link>
        )}
      </div>
    </section>
  );
}

/* ---------------- B. Concept cards ---------------- */

function ConceptCard({ concept, rank }: { concept: DiagnosisWeakConcept; rank: number }) {
  const { subjectSlug } = concept;
  return (
    <Card className="!p-4">
      {/* 뱃지/태그 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {rank}
        </span>
        {concept.frequency != null && <FrequencyBadge value={concept.frequency} />}
        <AccuracyBadge concept={concept} />
      </div>

      {/* 타이틀: 과목 + 개념 */}
      <div className="mt-2.5">
        {concept.subject && (
          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-500">{concept.subject}</p>
        )}
        <p className="text-base font-bold text-slate-900 dark:text-zinc-100">{concept.concept}</p>
      </div>

      {/* 액션 버튼 2개 */}
      <div className="mt-3.5 flex items-center gap-2">
        {subjectSlug ? (
          <>
            <Link
              href={`/mypage/wrong-notes/${subjectSlug}?view=questions`}
              className="inline-flex flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:text-blue-300"
            >
              <BookOpen size={15} /> 개념 정리 보기
            </Link>
            <SolveButton subjectSlug={subjectSlug} limit={5} label="맞춤 5문제 풀기" />
          </>
        ) : (
          <p className="text-xs text-slate-400 dark:text-zinc-600">
            이 개념은 과목 연결이 없어 바로 풀기를 만들 수 없어요.
          </p>
        )}
      </div>
    </Card>
  );
}

// 출제 빈도 ★★★ (1~3).
function FrequencyBadge({ value }: { value: number }) {
  const n = Math.max(0, Math.min(3, Math.round(value)));
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
      출제 빈도
      <span className="tracking-tight" aria-label={`별 ${n}개`}>
        {"★".repeat(n)}
        <span className="text-amber-300 dark:text-amber-800">{"★".repeat(3 - n)}</span>
      </span>
    </span>
  );
}

// 내 정답률(있으면) 또는 극복 진행도(대체). 낮을수록 빨강, 높을수록 초록.
function AccuracyBadge({ concept }: { concept: DiagnosisWeakConcept }) {
  const wrong = concept.wrongCount ?? 0;
  const resolved = concept.resolvedCount ?? 0;

  if (concept.accuracyPct != null) {
    const pct = Math.max(0, Math.min(100, Math.round(concept.accuracyPct)));
    const tone =
      pct < 40
        ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
        : pct < 70
          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300"
          : "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
        내 정답률 {pct}%
      </span>
    );
  }

  // 정답률 데이터가 없으면 극복 진행도로 대체(지어내지 않는다).
  if (wrong > 0) {
    const done = resolved >= wrong;
    const tone = done
      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
      : "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>
        극복 {resolved}/{wrong}
      </span>
    );
  }
  return null;
}

/* ---------------- C. Insight card ---------------- */

function InsightCard({ insights }: { insights: NonNullable<AiDiagnosisReport["insights"]> }) {
  return (
    <Card className="border-amber-100 bg-amber-50/60 dark:border-amber-900/40 dark:bg-amber-950/10">
      <SectionTitle icon={<AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />}>
        AI 오답 패턴 분석
      </SectionTitle>
      <ul className="mt-3 flex flex-col gap-3">
        {insights.map((ins, i) => (
          <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
            <p className="text-slate-700 dark:text-zinc-300">
              {ins.subject && <span className="font-bold text-slate-900 dark:text-zinc-100">{ins.subject} </span>}
              {ins.text}
              {ins.wrongRatePct != null && (
                <span className="ml-1 font-bold text-red-600 dark:text-red-400">
                  (오답률 {Math.round(ins.wrongRatePct)}%)
                </span>
              )}
            </p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ---------------- D. Subject trends ---------------- */

function TrendsCard({ trends }: { trends: DiagnosisSubjectTrend[] }) {
  return (
    <Card>
      <SectionTitle icon={<TrendingUp size={16} className="text-blue-600 dark:text-blue-400" />}>
        과목별 성적 추이
      </SectionTitle>
      <ul className="mt-3 flex flex-col divide-y divide-slate-100 dark:divide-zinc-800">
        {trends.map((t, i) => (
          <li key={`${t.subject}-${i}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-zinc-100">
                <TrendArrow trend={t.trend} />
                {t.subject}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">{t.note}</p>
            </div>
            <TrendVisual trend={t.trend} scores={t.scores ?? null} />
          </li>
        ))}
      </ul>
    </Card>
  );
}

function trendTone(trend: DiagnosisSubjectTrend["trend"]) {
  if (trend === "up") return { stroke: "#059669", text: "text-emerald-600 dark:text-emerald-400" };
  if (trend === "down") return { stroke: "#dc2626", text: "text-red-600 dark:text-red-400" };
  return { stroke: "#94a3b8", text: "text-slate-400 dark:text-zinc-500" };
}

function TrendArrow({ trend }: { trend: DiagnosisSubjectTrend["trend"] }) {
  const { text } = trendTone(trend);
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  return <Icon size={15} className={`shrink-0 ${text}`} />;
}

// 스파크라인(있으면) + 최신 점수. 점수가 없으면 화살표만 있는 셈이라 이 영역은 비운다.
function TrendVisual({ trend, scores }: { trend: DiagnosisSubjectTrend["trend"]; scores: number[] | null }) {
  const { text } = trendTone(trend);
  if (!scores || scores.length < 2) {
    const last = scores && scores.length === 1 ? scores[0] : null;
    return last != null ? (
      <span className={`shrink-0 text-lg font-bold tabular-nums ${text}`}>{last}점</span>
    ) : null;
  }
  return (
    <div className="flex shrink-0 items-center gap-2">
      <Sparkline scores={scores} trend={trend} />
      <span className={`text-lg font-bold tabular-nums ${text}`}>{scores[scores.length - 1]}점</span>
    </div>
  );
}

// 의존성 없는 순수 SVG 스파크라인. Recharts를 새로 들이는 대신 가볍게.
function Sparkline({ scores, trend }: { scores: number[]; trend: DiagnosisSubjectTrend["trend"] }) {
  const w = 64;
  const h = 24;
  const pad = 3;
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (scores.length - 1);
  const points = scores.map((s, i) => {
    const x = pad + i * stepX;
    const y = pad + (h - pad * 2) * (1 - (s - min) / span);
    return [x, y] as const;
  });
  const d = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const [lx, ly] = points[points.length - 1];
  const { stroke } = trendTone(trend);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible" aria-hidden>
      <path d={d} fill="none" stroke={stroke} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={2.5} fill={stroke} />
    </svg>
  );
}

/* ---------------- Mission fallback ---------------- */

// 생성기가 mission을 안 채웠으면 데이터로 안전하게 유도한다: 가장 시급한 취약 개념
// (미극복 우선)으로 한 줄 미션을 만든다. 없으면 요약 첫 문장으로 대체(Hero에서 처리).
function resolveMission(report: AiDiagnosisReport): DiagnosisMission | null {
  if (report.mission?.headline) return report.mission;
  const top = (report.weakConcepts ?? []).find(
    (c) => (c.resolvedCount ?? 0) < (c.wrongCount ?? 0),
  ) ?? (report.weakConcepts ?? [])[0];
  if (!top) return null;
  const where = top.subject ? `${top.subject} ` : "";
  return {
    headline: `${where}'${top.concept}'부터 잡아봐요. 지금 맞춤 5문제로 시작!`,
    subjectSlug: top.subjectSlug ?? null,
    concept: top.concept,
  };
}

/* ---------------- Empty / pending ---------------- */

async function EmptyState({
  supabase,
  userId,
  pending,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  pending: boolean;
}) {
  if (pending) {
    return (
      <Card className="border-blue-100 bg-blue-50/60 dark:border-blue-900/40 dark:bg-blue-950/20">
        <p className="flex items-center gap-2 text-sm font-bold text-blue-900 dark:text-blue-200">
          <Sparkles size={16} /> 오늘 진단을 준비하고 있어요
        </p>
        <p className="mt-1.5 text-sm text-blue-800/80 dark:text-blue-300/70">
          분석이 끝나면 여기에 리포트가 표시돼요(보통 하루 안).
        </p>
      </Card>
    );
  }
  const eligibility = await getDiagnosisEligibility(supabase, userId);
  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <Sparkles size={24} className="text-blue-500 dark:text-blue-400" />
      <p className="text-sm text-slate-500 dark:text-zinc-400">
        {eligibility.eligible
          ? "아직 받은 진단이 없어요. 오답노트에서 진단을 받아보세요."
          : (eligibility.hint ?? "조금 더 풀면 진단을 받을 수 있어요.")}
      </p>
      <Link
        href="/mypage?tab=wrong-notes"
        className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
      >
        오답노트로 가기
      </Link>
    </Card>
  );
}
