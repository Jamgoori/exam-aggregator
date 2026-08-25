import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getWeeklyDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  getLastAnalyzedDate,
  analysisWindowDays,
  nextDiagnosisDate,
  type DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";
import {
  getDiagnosisAggregate,
  type DiagnosisAggregate,
  type ConceptStat,
  type SubjectConceptGroup,
} from "@/lib/diagnosis-live";
import {
  ConceptSolveButton,
  DiagnosisCoachingButton,
  DiagnosisAutoGenerate,
} from "./diagnosis-actions";
import { isPremium } from "@/lib/membership";
import { MembershipLockedPage } from "@/components/membership-upsell";
import { isDiagnosisDevAllowed } from "@/lib/diagnosis-dev-gate";

// 기간 선택(?range=). 기본은 "지난 진단 이후"(최대 2주)로, AI가 실제로 분석하는 창과
// 같다 — 이 화면의 질문이 "지난 진단 뒤로 뭘 틀렸나"이기 때문이다. 그 기간에 푼 문제가
// 없으면 집계가 스스로 넓히고(widened), 사용자는 칩으로 직접 바꿀 수도 있다.
const RANGES = [
  // 기본값(cycle)은 분석 창과 같은 기간 — 마지막 진단 이후, 최대 2주. 그래프와 극복법이
  // 서로 다른 기간을 보면 "이 개념 3문항 틀림"과 코칭 내용이 어긋난다.
  { key: "cycle", days: null as number | null, label: "지난 진단 이후" },
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
//
// 화면은 장식(아이콘·색 배지·틴트 박스)을 쓰지 않는다. 여기서 읽을 것은 개념 이름과
// 틀린 문항 수뿐이라, 색은 막대 하나와 기본 버튼에만 남기고 나머지는 활자 크기와
// 여백으로만 위계를 만든다.
export default async function DiagnosisPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
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
  const rangeKey = (await searchParams)?.range;
  const selected = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  // "지난 진단 이후"는 사람마다 길이가 다르다 — 마지막 리포트 날짜에서 계산한다.
  const cycleDays = analysisWindowDays(await getLastAnalyzedDate(supabase, user.id));
  const days = selected.key === "cycle" ? cycleDays : selected.days;
  const agg = await getDiagnosisAggregate(user.id, { days });

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

  // 들어오자마자 극복법을 만들지 판단한다. 요금이 나가는 경로라 조건을 좁게 잠근다:
  //  - 아직 극복법이 없고
  //  - 이번 주기에 요청 행 자체가 없고(실패해 pending 으로 남은 뒤엔 자동 재시도 금지)
  //  - 진단 자격(누적 오답·응시 문턱)을 넘겼을 때만.
  // 그래서 자동 생성은 주기당 최대 1회다 — 새로고침을 반복해도 요금이 새지 않는다.
  const hasCoaching = (coaching ?? []).length > 0;
  const autoGenerate =
    !hasCoaching &&
    today == null &&
    agg.concepts.length > 0 &&
    (await getDiagnosisEligibility(supabase, user.id)).eligible;

  return (
    <div className="min-h-dvh bg-white dark:bg-zinc-950">
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-5 pb-20 pt-6 sm:pt-10">
        <header className="flex flex-col gap-3 border-b border-slate-200 pb-5 dark:border-zinc-800">
          <Link
            href="/mypage?tab=wrong-notes"
            className="text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            ← 오답노트로
          </Link>
          <div className="flex flex-col gap-1">
            <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-900 dark:text-zinc-100">
              약점 진단
            </h1>
            <p className="text-sm text-slate-500 dark:text-zinc-500">
              틀린 문항을 개념별로 모아서 보여드려요.
            </p>
          </div>
        </header>

        {agg.concepts.length === 0 ? (
          <EmptyState supabase={supabase} userId={user.id} />
        ) : (
          <Dashboard
            agg={agg}
            coachingByConcept={coachingByConcept}
            hasCoaching={hasCoaching}
            requestedThisWeek={today != null}
            nextDate={nextDate}
            selectedKey={selected.key}
            autoGenerate={autoGenerate}
          />
        )}
      </div>
    </div>
  );
}

function SectionTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <h2 className="text-base font-bold text-slate-900 dark:text-zinc-100">{children}</h2>
      {hint && <p className="text-xs text-slate-500 dark:text-zinc-500">{hint}</p>}
    </div>
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
  autoGenerate,
}: {
  agg: DiagnosisAggregate;
  coachingByConcept: Map<string, DiagnosisConceptCoaching>;
  hasCoaching: boolean;
  // 다음 진단을 받을 수 있는 날(YYYY-MM-DD). 이번 주기에 이미 받았을 때만 값이 있다.
  nextDate: string | null;
  // 지금 선택된 기간 칩(RANGES.key).
  selectedKey: string;
  // 들어오자마자 극복법을 자동 생성할지(주기당 1회). page.tsx 가 판정한다.
  autoGenerate: boolean;
  // 이번 주 진단 행이 이미 있는지. 있는데 극복법이 없다면 생성이 실패해 pending으로
  // 남은 것이므로 버튼을 "다시 시도"로 보여준다.
  requestedThisWeek: boolean;
}) {
  const topConcepts = agg.concepts.slice(0, CONCEPT_CARD_LIMIT);
  const maxWrong = Math.max(1, ...agg.concepts.map((c) => c.wrongCount));

  return (
    <div className="flex flex-col gap-10">
      {/* A. 과목별 틀린 개념 막대그래프 */}
      <section className="flex flex-col gap-4">
        <SectionTitle
          hint={
            agg.window.widened
              ? "선택한 기간에 푼 문제가 없어 기간을 넓혔어요."
              : "막대가 길수록 그 개념에서 더 많이 틀렸어요."
          }
        >
          {rangeLabel(agg.window.days)} 틀린 개념
        </SectionTitle>

        {/* 기간 전환은 탭처럼 — 칩 세 개를 색으로 칠하면 이 화면에서 가장 눈에 띄는
            요소가 되어버린다. 밑줄만으로 현재 위치를 표시한다. */}
        <div className="flex gap-5 border-b border-slate-200 dark:border-zinc-800">
          {RANGES.map((r) => {
            const active = r.key === selectedKey;
            return (
              <Link
                key={r.key}
                href={`/mypage/diagnosis?range=${r.key}`}
                scroll={false}
                className={`-mb-px border-b-2 pb-2 text-sm transition-colors ${
                  active
                    ? "border-slate-900 font-semibold text-slate-900 dark:border-zinc-100 dark:text-zinc-100"
                    : "border-transparent text-slate-500 hover:text-slate-800 dark:text-zinc-500 dark:hover:text-zinc-300"
                }`}
              >
                {r.label}
              </Link>
            );
          })}
        </div>

        <div className="flex flex-col gap-7">
          {agg.bySubject.map((g) => (
            <SubjectBars key={g.subjectSlug ?? g.subject} group={g} maxWrong={maxWrong} />
          ))}
        </div>
      </section>

      {/* B. 개념별 카드 */}
      <section className="flex flex-col gap-4">
        <SectionTitle hint="틀린 문항이 많은 개념부터 정리했어요.">개념별 정리</SectionTitle>
        {!hasCoaching &&
          (autoGenerate ? (
            <DiagnosisAutoGenerate />
          ) : (
            <DiagnosisCoachingButton requestedThisWeek={requestedThisWeek} nextDate={nextDate} />
          ))}
        <div className="flex flex-col divide-y divide-slate-200 border-y border-slate-200 dark:divide-zinc-800 dark:border-zinc-800">
          {topConcepts.map((c, i) => (
            <ConceptCard
              key={`${c.concept}-${i}`}
              rank={i + 1}
              concept={c}
              coaching={coachingByConcept.get(c.concept) ?? null}
            />
          ))}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-slate-400 dark:text-zinc-600">
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
      <p className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-slate-900 dark:text-zinc-100">
          {group.subject}
        </span>
        <span className="text-xs text-slate-400 dark:text-zinc-500">
          {group.totalWrong}문항 틀림
        </span>
      </p>
      <div className="flex flex-col gap-2.5">
        {shown.map((c, i) => (
          <ConceptBar key={`${c.concept}-${i}`} concept={c} maxWrong={maxWrong} />
        ))}
      </div>
      {hidden > 0 && (
        <p className="mt-2 text-xs text-slate-400 dark:text-zinc-600">외 {hidden}개 개념</p>
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
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="min-w-0 text-[13px] leading-snug text-slate-700 dark:text-zinc-300">
          {concept.concept}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-400 dark:text-zinc-500">
          <b className="font-semibold text-slate-700 dark:text-zinc-300">{concept.wrongCount}</b>
          문항
          {concept.accuracyPct != null ? ` · 정답률 ${concept.accuracyPct}%` : ""}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-sm bg-slate-100 dark:bg-zinc-800">
        <div className="h-full rounded-sm bg-slate-700 dark:bg-zinc-400" style={{ width: `${pct}%` }} />
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
  // 배지 대신 한 줄 메타. 숫자마다 색 알약을 붙이면 개념 이름보다 배지가 먼저 읽힌다.
  const meta = [
    `${concept.wrongCount}문항 틀림`,
    concept.answeredCount > 0 ? `푼 문항 ${concept.answeredCount}개` : null,
    concept.accuracyPct != null ? `정답률 ${concept.accuracyPct}%` : null,
    concept.corpusCount > 0 ? `기출 ${concept.corpusCount}문항` : null,
  ].filter(Boolean) as string[];

  return (
    <article className="flex gap-3.5 py-5">
      <span className="w-5 shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-slate-300 dark:text-zinc-700">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        {concept.subject && (
          <p className="text-xs text-slate-500 dark:text-zinc-500">{concept.subject}</p>
        )}
        <h3 className="mt-0.5 text-[15px] font-bold leading-snug text-slate-900 dark:text-zinc-100">
          {concept.concept}
        </h3>
        {/* 데이터: 이 개념에서 주로 어땠는지(무AI) */}
        <p className="mt-1.5 text-xs tabular-nums text-slate-500 dark:text-zinc-400">
          {meta.join(" · ")}
        </p>

        {/* AI: 맞춤 극복법(있으면) */}
        {coaching && (
          <div className="mt-3 border-l-2 border-slate-200 pl-3.5 dark:border-zinc-700">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-zinc-500">
              극복법
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
              {coaching.weakPattern}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
              {coaching.howToOvercome}
            </p>
          </div>
        )}

        {/* 액션: 같은 개념 기출 풀기 */}
        <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
          {canSolve ? (
            <ConceptSolveButton
              concept={concept.concept}
              conceptId={concept.conceptId}
              subjectSlug={concept.subjectSlug as string}
              limit={5}
              label="같은 개념 기출 5문제"
            />
          ) : (
            <p className="text-xs text-slate-400 dark:text-zinc-600">
              이 개념은 기출이 적어 풀기를 만들 수 없어요.
            </p>
          )}
          {concept.subjectSlug && (
            <Link
              href={`/mypage/wrong-notes/${concept.subjectSlug}?view=questions`}
              className="text-sm text-slate-500 underline underline-offset-4 transition-colors hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-200"
            >
              틀린 문항 보기
            </Link>
          )}
        </div>
      </div>
    </article>
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
    <div className="flex flex-col items-start gap-4 border-y border-slate-200 py-8 dark:border-zinc-800">
      <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
        {eligibility.eligible
          ? "아직 분석할 오답 개념이 없어요. 문제를 조금 더 풀면 여기에 약점이 정리돼요."
          : (eligibility.hint ?? "조금 더 풀면 진단을 받을 수 있어요.")}
      </p>
      <Link
        href="/mypage?tab=wrong-notes"
        className="rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
      >
        오답노트로 가기
      </Link>
    </div>
  );
}
