import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles, BarChart3, Flame, Lightbulb, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getTodayDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  type DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";
import {
  getDiagnosisAggregate,
  type DiagnosisAggregate,
  type ConceptStat,
  type SubjectConceptGroup,
} from "@/lib/diagnosis-live";
import { ConceptSolveButton } from "./diagnosis-actions";
import { isPremium } from "@/lib/membership";
import { MembershipLockedPage } from "@/components/membership-upsell";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";

// AI 약전진단(리뉴얼). 입장 즉시 보이는 것은 전부 결정적 데이터(무AI):
//  A) 과목별 틀린 개념 막대그래프 — 어디가 약한지 한눈에.
//  B) 개념별 카드 — 이 개념에서 주로 어떤 문제를 틀렸는지(데이터) + 맞춤 극복법(AI, 진단받기
//     때 생성·캐시) + 같은 개념 기출 5문제 풀기.
// AI(극복법)는 마이페이지 "진단받기"를 눌러야 생성된다. 아직 없으면 데이터층만 그리고
// 극복법 자리에 안내를 둔다.
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

  // 개발 중 임시 게이트: 이 계정 외에는 기능 자체를 노출하지 않는다.
  if (!isDiagnosisDevAllowed(user.email)) {
    redirect("/mypage?tab=wrong-notes");
  }

  // AI 약점 진단은 멤버십 기능. 아래 라이브 집계가 계정 전체 오답을 훑는 무거운
  // 작업이라, 못 볼 화면을 위해 돌리지 않도록 집계 전에 판정한다.
  if (!(await isPremium(supabase, user!.id))) {
    return (
      <MembershipLockedPage
        title="AI 약점 진단은 멤버십 기능이에요"
        description="과목별로 어떤 개념에서 주로 틀리는지 그래프로 보여주고, 개념마다 맞춤 극복법과 같은 개념 기출 문제를 이어줘요. 지금까지 쌓인 오답은 그대로 남아 있어요."
        backHref="/mypage?tab=wrong-notes"
        backLabel="오답노트로"
        next="/mypage/diagnosis"
      />
    );
  }

  // 데이터층(무AI): 막대그래프·개념 카드. 페이지 입장 즉시 라이브 집계.
  const agg = await getDiagnosisAggregate(user.id);

  // AI 극복법(있으면): 오늘 리포트 → 없으면 최근 완료 리포트에서 conceptCoaching만 가져온다.
  const today = await getTodayDiagnosis(supabase, user.id);
  let coaching = today?.report?.conceptCoaching ?? null;
  if (!coaching || coaching.length === 0) {
    const latest = await getLatestReadyDiagnosis(supabase, user.id);
    coaching = latest?.report?.conceptCoaching ?? null;
  }
  const coachingByConcept = new Map<string, DiagnosisConceptCoaching>();
  for (const c of coaching ?? []) coachingByConcept.set(c.concept, c);

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
        </header>

        {agg.concepts.length === 0 ? (
          <EmptyState supabase={supabase} userId={user.id} />
        ) : (
          <Dashboard agg={agg} coachingByConcept={coachingByConcept} hasCoaching={(coaching ?? []).length > 0} />
        )}
      </div>
    </div>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-2xl border border-slate-100 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 ${className}`}
    >
      {children}
    </section>
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

// 카드에 보여줄 개념 상한(막대그래프엔 전부, 카드엔 시급한 상위만).
const CONCEPT_CARD_LIMIT = 8;
// 같은개념 기출 풀기를 열어줄 최소 코퍼스 문항 수(너무 적으면 연습 가치가 약함).
const MIN_CORPUS_FOR_SOLVE = 2;

function Dashboard({
  agg,
  coachingByConcept,
  hasCoaching,
}: {
  agg: DiagnosisAggregate;
  coachingByConcept: Map<string, DiagnosisConceptCoaching>;
  hasCoaching: boolean;
}) {
  const topConcepts = agg.concepts.slice(0, CONCEPT_CARD_LIMIT);
  const maxWrong = Math.max(1, ...agg.concepts.map((c) => c.wrongCount));

  return (
    <div className="flex flex-col gap-6">
      {/* A. 과목별 틀린 개념 막대그래프 */}
      <Card>
        <SectionTitle icon={<BarChart3 size={16} className="text-blue-600 dark:text-blue-400" />}>
          과목별 틀린 개념
        </SectionTitle>
        <p className="mt-1 px-1 text-xs text-slate-500 dark:text-zinc-500">
          막대가 길수록 그 개념에서 더 많이 틀렸어요.
        </p>
        <div className="mt-4 flex flex-col gap-5">
          {agg.bySubject.map((g) => (
            <SubjectBars key={g.subjectSlug ?? g.subject} group={g} maxWrong={maxWrong} />
          ))}
        </div>
      </Card>

      {/* B. 개념별 카드 */}
      <div className="flex flex-col gap-3">
        <SectionTitle icon={<Flame size={16} className="text-blue-600 dark:text-blue-400" />}>
          개념별 정리 · 극복
        </SectionTitle>
        {!hasCoaching && (
          <div className="rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-xs text-violet-800 dark:border-violet-900/50 dark:bg-violet-950/20 dark:text-violet-200">
            맞춤 극복법은{" "}
            <Link href="/mypage?tab=wrong-notes" className="font-bold underline">
              오답노트에서 &lsquo;진단 받기&rsquo;
            </Link>
            를 누르면 개념별로 생성돼요(하루 1회).
          </div>
        )}
        {topConcepts.map((c, i) => (
          <ConceptCard
            key={`${c.concept}-${i}`}
            rank={i + 1}
            concept={c}
            coaching={coachingByConcept.get(c.concept) ?? null}
          />
        ))}
      </div>

      <p className="px-1 text-center text-xs text-slate-400 dark:text-zinc-600">
        그래프·문제는 실시간 데이터예요. 맞춤 극복법만 하루 1회 AI가 생성해요.
      </p>
    </div>
  );
}

// 한 과목 그룹의 개념 막대들. 개념이 많으면 상위만 보이고 나머지는 접는다.
const BARS_PER_SUBJECT = 6;

function SubjectBars({ group, maxWrong }: { group: SubjectConceptGroup; maxWrong: number }) {
  const shown = group.concepts.slice(0, BARS_PER_SUBJECT);
  const hidden = group.concepts.length - shown.length;
  return (
    <div>
      <p className="mb-2 flex items-baseline justify-between px-1">
        <span className="text-sm font-bold text-slate-900 dark:text-zinc-100">{group.subject}</span>
        <span className="text-xs text-slate-400 dark:text-zinc-500">틀린 {group.totalWrong}문항</span>
      </p>
      <div className="flex flex-col gap-1.5">
        {shown.map((c, i) => (
          <ConceptBar key={`${c.concept}-${i}`} concept={c} maxWrong={maxWrong} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-1.5 px-1 text-xs text-slate-400 dark:text-zinc-600">외 {hidden}개 개념</p>
      )}
    </div>
  );
}

function ConceptBar({ concept, maxWrong }: { concept: ConceptStat; maxWrong: number }) {
  const pct = Math.max(6, Math.round((concept.wrongCount / maxWrong) * 100));
  const resolved = (concept.resolvedCount ?? 0) >= concept.wrongCount && concept.wrongCount > 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 truncate text-xs text-slate-600 dark:text-zinc-400" title={concept.concept}>
        {concept.concept}
      </span>
      <div className="h-4 flex-1 overflow-hidden rounded bg-slate-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded ${resolved ? "bg-emerald-400 dark:bg-emerald-500" : "bg-blue-500 dark:bg-blue-500"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-6 shrink-0 text-right text-xs font-bold tabular-nums text-slate-500 dark:text-zinc-400">
        {concept.wrongCount}
      </span>
    </div>
  );
}

function ConceptCard({
  rank,
  concept,
  coaching,
}: {
  rank: number;
  concept: ConceptStat;
  coaching: DiagnosisConceptCoaching | null;
}) {
  const canSolve = concept.subjectSlug != null && concept.corpusCount >= MIN_CORPUS_FOR_SOLVE;
  return (
    <Card className="!p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
          {rank}
        </span>
        <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-700 dark:bg-red-950/30 dark:text-red-300">
          {concept.wrongCount}회 틀림
        </span>
        {concept.accuracyPct != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600 dark:bg-zinc-800 dark:text-zinc-300">
            정답률 {concept.accuracyPct}%
          </span>
        )}
        {concept.corpusCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-700 dark:bg-amber-950/30 dark:text-amber-300">
            기출 {concept.corpusCount}문항
          </span>
        )}
      </div>

      <div className="mt-2.5">
        {concept.subject && (
          <p className="text-xs font-semibold text-slate-500 dark:text-zinc-500">{concept.subject}</p>
        )}
        <p className="text-base font-bold text-slate-900 dark:text-zinc-100">{concept.concept}</p>
      </div>

      {/* 데이터: 이 개념에서 주로 어땠는지(무AI) */}
      <p className="mt-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-400">
        {concept.wrongCount}문항 중 {concept.resolvedCount}개 극복
        {concept.corpusCount > 0 ? ` · 전체 기출 ${concept.corpusCount}문항` : ""}.
      </p>

      {/* AI: 맞춤 극복법(있으면) */}
      {coaching && (
        <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3 dark:border-blue-900/40 dark:bg-blue-950/10">
          <p className="flex items-center gap-1.5 text-xs font-bold text-blue-700 dark:text-blue-300">
            <Lightbulb size={13} /> 맞춤 극복법
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
            {coaching.weakPattern}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
            {coaching.howToOvercome}
          </p>
        </div>
      )}

      {/* 액션: 같은 개념 기출 풀기 */}
      <div className="mt-3.5 flex items-center gap-2">
        {concept.subjectSlug && (
          <Link
            href={`/mypage/wrong-notes/${concept.subjectSlug}?view=questions`}
            className="inline-flex items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition-colors hover:border-blue-300 hover:text-blue-700 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:border-blue-800 dark:hover:text-blue-300"
          >
            <BookOpen size={15} /> 틀린 문항 보기
          </Link>
        )}
        {canSolve ? (
          <ConceptSolveButton
            concept={concept.concept}
            subjectSlug={concept.subjectSlug as string}
            limit={5}
            label="같은 개념 기출 5문제"
            className="flex-1"
          />
        ) : (
          <p className="text-xs text-slate-400 dark:text-zinc-600">
            이 개념은 기출이 적어 풀기를 만들 수 없어요.
          </p>
        )}
      </div>
    </Card>
  );
}

async function EmptyState({
  supabase,
  userId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
}) {
  const eligibility = await getDiagnosisEligibility(supabase, userId);
  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <Sparkles size={24} className="text-blue-500 dark:text-blue-400" />
      <p className="text-sm text-slate-500 dark:text-zinc-400">
        {eligibility.eligible
          ? "아직 분석할 오답 개념이 없어요. 문제를 조금 더 풀면 여기에 약점이 정리돼요."
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
