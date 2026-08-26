import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BarChart3, Flame, Lightbulb, BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getWeeklyDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  getLastAnalyzedDate,
  analysisWindowDays,
  GRAPH_MIN_WINDOW_DAYS,
  nextDiagnosisDate,
  type DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";
import {
  getDiagnosisAggregate,
  type DiagnosisAggregate,
  type ConceptStat,
  type SubjectStat,
  type SubjectConceptGroup,
} from "@/lib/diagnosis-live";
import { ConceptSolveButton, DiagnosisSubjectPicker } from "./diagnosis-actions";
import { getDiagnosisPausedSubjectIds } from "@/lib/review-preferences";
import { isPremium } from "@/lib/membership";
import { MembershipLockedPage } from "@/components/membership-upsell";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";

// 기간 선택(?range=). 기본(cycle)은 "지난 진단 이후"이되 최소 7일을 보장한다
// (GRAPH_MIN_WINDOW_DAYS). 진단 직후엔 그 창이 1일이라 어제 푼 것만 남는데, 사다리는
// 오답이 0일 때만 넓혀서 하루라도 틀렸으면 갇히기 때문이다. 그 기간에 푼 문제가 아예
// 없으면 집계가 스스로 더 넓히고(widened), 사용자는 칩으로 직접 바꿀 수도 있다.
// "기본" 칩의 라벨은 실제 기간(cycleDays)으로 그린다 — 사람마다 7일이거나 14일이다.
const RANGES = [
  // 기본값(cycle)은 분석 창과 같은 기간 — 마지막 진단 이후, 최대 2주. 그래프와 극복법이
  // 서로 다른 기간을 보면 "이 개념 3문항 틀림"과 코칭 내용이 어긋난다.
  { key: "cycle", days: null as number | null, label: "기본" },
  { key: "30", days: 30 as number | null, label: "최근 30일" },
  { key: "all", days: null as number | null, label: "전체" },
];

function rangeLabel(days: number | null): string {
  if (days == null) return "전체 기간";
  return `최근 ${days}일`;
}

// AI 약점 진단. 입장 즉시 보이는 것은 전부 결정적 데이터(무AI):
//  A) 선택한 기간에 틀린 개념 막대그래프 — 그 기간에 뭘 틀렸는지 한눈에.
//  B) 개념별 카드 — 이 기간에 몇 문항 틀렸는지(데이터) + 맞춤 극복법(AI, 주 1회 생성·캐시)
//     + 같은 개념 기출 5문제 풀기.
// AI(극복법)는 이 페이지에 들어오면 자동으로 생성된다(주기당 1회, 아래 autoGenerate).
// 생성 전·실패 시에도 데이터층은 그대로 보인다.
export default async function DiagnosisPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; subject?: string }>;
}) {
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
  const params = await searchParams;
  const rangeKey = params?.range;
  const selected = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  // "지난 진단 이후"는 사람마다 길이가 다르다 — 마지막 리포트 날짜에서 계산한다.
  // 다만 그래프는 최소 7일을 보장한다(GRAPH_MIN_WINDOW_DAYS 주석 참고): 진단 다음 날
  // 들어오면 창이 1일이 되어 어제 푼 것만 남는데, 사다리는 오답이 0일 때만 넓혀서
  // 하루라도 틀렸으면 그대로 갇힌다.
  const cycleDays = Math.max(
    GRAPH_MIN_WINDOW_DAYS,
    analysisWindowDays(await getLastAnalyzedDate(supabase, user.id)),
  );
  const days = selected.key === "cycle" ? cycleDays : selected.days;

  // 과목 칩(?subject=). 응시한 과목 목록이 필요해서 한 번은 전체로 집계한다 — 필터를
  // 걸면 그 과목 개념만 남아 칩을 그릴 수 없다. 과목별 응시 통계(agg.subjects)는 기간과
  // 무관하게 전체 응시에서 나오므로, 필터를 건 뒤에도 칩 목록은 그대로 쓴다.
  const all = await getDiagnosisAggregate(user.id, { days });
  const subjectSlug =
    params?.subject && all.subjects.some((s) => s.slug === params.subject) ? params.subject : null;
  const agg = subjectSlug
    ? await getDiagnosisAggregate(user.id, { days, subjectSlug })
    : all;

  // AI 극복법(있으면): 이번 주 리포트 → 없으면 지난 완료 리포트에서 conceptCoaching만 가져온다.
  const today = await getWeeklyDiagnosis(supabase, user.id);
  let coaching = today?.report?.conceptCoaching ?? null;
  if (!coaching || coaching.length === 0) {
    const latest = await getLatestReadyDiagnosis(supabase, user.id);
    coaching = latest?.report?.conceptCoaching ?? null;
  }
  const coachingByConcept = new Map<string, DiagnosisConceptCoaching>();
  for (const c of coaching ?? []) coachingByConcept.set(c.concept, c);

  // 주기 안내: 이번 주기에 이미 받았으면 언제 다시 받을 수 있는지 알려준다.
  const nextDate = today ? nextDiagnosisDate(today.date) : null;

  // 극복법은 자동 생성하지 않는다. 예전에는 페이지 입장만으로 만들었는데, 그러면
  // 사용자가 분석할 과목을 고를 틈이 없다 — 준비하지 않는 과목이 상한(과목당 7개·전체
  // 20개)을 차지한 채 요금까지 나간다. 이제 선택창에서 고르고 직접 누른다.
  const hasCoaching = (coaching ?? []).length > 0;
  const canGenerate =
    !hasCoaching &&
    agg.concepts.length > 0 &&
    (await getDiagnosisEligibility(supabase, user.id)).eligible;
  // 선택창에 뿌릴 과목별 오답 수(전체 기간 아님 — 지금 보고 있는 창 기준). 어떤 과목을
  // 뺄지 판단하려면 그 과목에서 뭘 얼마나 틀렸는지가 같이 보여야 한다.
  const wrongBySubjectSlug = new Map(all.bySubject.map((g) => [g.subjectSlug, g.totalWrong]));
  const pickerSubjects = all.subjects.map((s) => ({
    id: s.id,
    name: s.name,
    wrongCount: wrongBySubjectSlug.get(s.slug) ?? 0,
  }));
  const excludedSubjectIds = [...(await getDiagnosisPausedSubjectIds(supabase, user.id))];

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
          <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">AI 약점 진단</h1>
        </header>

        {agg.concepts.length === 0 ? (
          <EmptyState
            supabase={supabase}
            userId={user.id}
            subjectName={all.subjects.find((s) => s.slug === subjectSlug)?.name ?? null}
          />
        ) : (
          <Dashboard
            agg={agg}
            coachingByConcept={coachingByConcept}
            hasCoaching={hasCoaching}
            requestedThisWeek={today != null}
            nextDate={nextDate}
            selectedKey={selected.key}
            cycleDays={cycleDays}
            subjects={all.subjects}
            subjectSlug={subjectSlug}
            canGenerate={canGenerate}
            pickerSubjects={pickerSubjects}
            excludedSubjectIds={excludedSubjectIds}
          />
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

// 기간·과목 칩은 서로의 선택을 지운다면 안 된다 — 링크에 둘 다 실어 준다.
function chipHref({ range, subject }: { range: string; subject: string | null }): string {
  const q = new URLSearchParams({ range });
  if (subject) q.set("subject", subject);
  return `/mypage/diagnosis?${q.toString()}`;
}

function Chip({ href, active, children }: { href: string; active: boolean; children: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      className={`rounded-full px-2.5 py-1 text-xs font-semibold transition-colors ${
        active
          ? "bg-blue-600 text-white"
          : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
      }`}
    >
      {children}
    </Link>
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

// "2026-08-31" → "8월 31일". 주기 안내에 쓴다.
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 카드에 보여줄 개념 상한(막대그래프엔 전부, 카드엔 시급한 상위만).
const CONCEPT_CARD_LIMIT = 8;
// 같은개념 기출 풀기를 열어줄 최소 코퍼스 문항 수(너무 적으면 연습 가치가 약함).
const MIN_CORPUS_FOR_SOLVE = 2;

function Dashboard({
  agg,
  coachingByConcept,
  hasCoaching,
  requestedThisWeek,
  nextDate,
  selectedKey,
  cycleDays,
  subjects,
  subjectSlug,
  canGenerate,
  pickerSubjects,
  excludedSubjectIds,
}: {
  agg: DiagnosisAggregate;
  // "기본" 칩이 실제로 훑는 일수. 라벨에 그대로 쓴다.
  cycleDays: number;
  // 과목 칩 목록(응시한 과목 전체). 필터를 걸어도 이 목록은 줄지 않는다.
  subjects: SubjectStat[];
  // 지금 선택된 과목 slug. null이면 전체.
  subjectSlug: string | null;
  // 지금 극복법을 만들 수 있는 상태인지(자격·오답 있음·아직 극복법 없음).
  canGenerate: boolean;
  // 선택창에 뿌릴 과목 목록(id·이름·이 기간 오답 수).
  pickerSubjects: { id: string; name: string; wrongCount: number }[];
  // 진단에서 뺀 과목 id.
  excludedSubjectIds: string[];
  coachingByConcept: Map<string, DiagnosisConceptCoaching>;
  hasCoaching: boolean;
  // 다음 진단을 받을 수 있는 날(YYYY-MM-DD). 이번 주기에 이미 받았을 때만 값이 있다.
  nextDate: string | null;
  // 지금 선택된 기간 칩(RANGES.key).
  selectedKey: string;
  // 이번 주 진단 행이 이미 있는지. 있는데 극복법이 없다면 생성이 실패해 pending으로
  // 남은 것이므로 버튼을 "다시 시도"로 보여준다.
  requestedThisWeek: boolean;
}) {
  const topConcepts = agg.concepts.slice(0, CONCEPT_CARD_LIMIT);
  const maxWrong = Math.max(1, ...agg.concepts.map((c) => c.wrongCount));

  return (
    <div className="flex flex-col gap-6">
      {/* A. 과목별 틀린 개념 막대그래프 */}
      <Card>
        <SectionTitle icon={<BarChart3 size={16} className="text-blue-600 dark:text-blue-400" />}>
          {rangeLabel(agg.window.days)} 틀린 개념
        </SectionTitle>
        <p className="mt-1 px-1 text-xs text-slate-500 dark:text-zinc-500">
          {agg.window.widened
            ? "선택한 기간에 푼 문제가 없어 기간을 넓혔어요."
            : "막대가 길수록 그 개념에서 더 많이 틀렸어요."}
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex gap-1.5 px-1">
            {RANGES.map((r) => (
              <Chip
                key={r.key}
                href={chipHref({ range: r.key, subject: subjectSlug })}
                active={r.key === selectedKey}
              >
                {r.key === "cycle" ? `최근 ${cycleDays}일` : r.label}
              </Chip>
            ))}
          </div>
          {/* 과목 칩: 한 과목만 파고들 때 쓴다. 개념 상위 30개를 자르기 전에 걸러서,
              과목을 고르면 그 과목 개념이 30개까지 온전히 나온다. */}
          {subjects.length > 1 && (
            <div className="flex flex-wrap gap-1.5 px-1">
              <Chip href={chipHref({ range: selectedKey, subject: null })} active={subjectSlug == null}>
                전체 과목
              </Chip>
              {subjects.map((s) => (
                <Chip
                  key={s.slug}
                  href={chipHref({ range: selectedKey, subject: s.slug })}
                  active={subjectSlug === s.slug}
                >
                  {s.name}
                </Chip>
              ))}
            </div>
          )}
        </div>
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
        {!hasCoaching && canGenerate && (
          <DiagnosisSubjectPicker
            subjects={pickerSubjects}
            excludedSubjectIds={excludedSubjectIds}
            requestedThisWeek={requestedThisWeek}
            nextDate={nextDate}
          />
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
        그래프는 {rangeLabel(agg.window.days)} 실시간 데이터예요. 맞춤 극복법은 주 1회, 지난
        진단 이후(최대 2주)에 틀린 문제만 분석해요.
        {hasCoaching && nextDate ? ` 다음 진단은 ${formatMonthDay(nextDate)}부터.` : ""}
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
        <span className="text-xs text-slate-400 dark:text-zinc-500">{group.totalWrong}문항 틀림</span>
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

// 개념 막대 하나. 라벨을 막대 위에 두는 건 개념 이름이 길기 때문이다 — 좌측 고정폭에
// 넣으면 "글의 내용과 일치·불일치 판단"이 "글의 내용과 일치…"로 잘려 정작 알아야 할
// 정보가 사라진다. 막대는 이 기간에 틀린 문항 수만 나타낸다(극복 여부는 세지 않는다).
function ConceptBar({ concept, maxWrong }: { concept: ConceptStat; maxWrong: number }) {
  const pct = Math.max(4, Math.round((concept.wrongCount / maxWrong) * 100));
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="min-w-0 text-[13px] leading-snug text-slate-700 dark:text-zinc-300">
          {concept.concept}
        </span>
        <span className="shrink-0 text-xs text-slate-400 dark:text-zinc-500">
          <b className="text-sm font-bold text-blue-600 dark:text-blue-400">{concept.wrongCount}</b>
          문항
          {concept.accuracyPct != null ? ` · 정답률 ${concept.accuracyPct}%` : ""}
          {concept.scoreGainPct != null && concept.scoreGainPct >= 0.5
            ? ` · +${concept.scoreGainPct}점`
            : ""}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-blue-500"
          style={{ width: `${pct}%` }}
        />
      </div>
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
        {/* 예상 점수. 0.5점 미만은 뱃지로 띄우면 오히려 "해봐야 소용없다"로 읽혀 숨긴다. */}
        {concept.scoreGainPct != null && concept.scoreGainPct >= 0.5 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">
            잡으면 +{concept.scoreGainPct}점
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
        이 기간에 {concept.wrongCount}문항 틀렸어요
        {concept.answeredCount > 0 ? ` (푼 문항 ${concept.answeredCount}개)` : ""}
        {concept.corpusCount > 0 ? ` · 전체 기출 ${concept.corpusCount}문항` : ""}.
        {/* 상한이라는 걸 숫자 옆에 같이 적는다 — "+3.3점"만 크게 띄우면 과장이 된다. */}
        {concept.scoreGainPct != null && concept.scoreGainPct >= 0.5
          ? ` 이 개념을 전부 맞혔다면 그 과목 회차 점수가 ${concept.scoreGainPct}점 높았어요.`
          : ""}
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
            conceptId={concept.conceptId}
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
  subjectName,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  // 과목 칩으로 좁힌 상태라면 그 과목 이름. "데이터가 없다"와 "이 과목만 없다"를
  // 구분해 주지 않으면 사용자가 진단이 고장 난 줄 안다.
  subjectName: string | null;
}) {
  const eligibility = await getDiagnosisEligibility(supabase, userId);
  return (
    <Card className="flex flex-col items-center gap-3 text-center">
      <p className="text-sm text-slate-500 dark:text-zinc-400">
        {subjectName
          ? `이 기간에 ${subjectName}에서 틀린 문제가 없어요. 기간을 넓히거나 다른 과목을 골라보세요.`
          : eligibility.eligible
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
