import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
// 없으면 집계가 스스로 넓히고(widened), 사용자는 탭으로 직접 바꿀 수도 있다.
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

// AI 약점 진단. 입장 즉시 보이는 것은 전부 결정적 데이터(무AI)이고, AI(극복법)는 그 위에
// 얹힌다 — 들어오면 자동으로 생성되며(주기당 1회, 아래 autoGenerate) 생성 전·실패 시에도
// 데이터층은 그대로 보인다.
//
// 화면 구조는 "요약 한 줄 → 지금 할 일 하나 → 과목별 개념 목록" 세 층이다. 예전에는
// 막대그래프와 개념 카드가 따로 있어서 같은 개념·같은 숫자를 위아래로 두 번 읽어야 했고
// (게다가 그래프는 과목당 상위 6개, 카드는 전체 상위 8개라 목록이 서로 어긋났다),
// 여덟 장의 카드가 전부 같은 무게라 "그래서 지금 뭘 하지"가 없었다. 그래서
//  - 개념 하나는 화면에 한 번만 나온다 — 막대·수치·극복법·풀기가 한 행에 모여 있고,
//    자세한 내용은 그 행을 펼쳐서 본다(접기/펼치기, JS 없이 <details>).
//  - 과목이 목록의 축이다. 오답이 한 과목에 몰렸는지 흩어졌는지가 스크롤 없이 보인다.
//  - 맨 위 한 칸이 다음 행동을 정해준다(가장 많이 틀린 개념의 기출 풀기).
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
        description="과목별로 어떤 개념에서 주로 틀리는지 보여주고, 개념마다 맞춤 극복법과 같은 개념 기출 문제를 이어줘요. 지금까지 쌓인 오답은 그대로 남아 있어요."
        backHref="/mypage?tab=wrong-notes"
        backLabel="오답노트로"
        next="/mypage/diagnosis"
      />
    );
  }

  // 데이터층(무AI): 개념 목록. 페이지 입장 즉시 라이브 집계.
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
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-7 px-5 pb-20 pt-6 sm:pt-10">
        <header className="flex flex-col gap-3">
          <Link
            href="/mypage?tab=wrong-notes"
            className="text-sm text-slate-500 transition-colors hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-200"
          >
            ← 오답노트로
          </Link>
          <h1 className="text-[26px] font-bold leading-tight tracking-tight text-slate-900 dark:text-zinc-100">
            약점 진단
          </h1>
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

// "2026-08-31" → "8월 31일". 주기 안내에 쓴다.
function formatMonthDay(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(m)}월 ${Number(d)}일`;
}

// 과목당 기본으로 펼쳐 두는 개념 행 수. 나머지는 과목 안에서 한 번 더 접는다 — 과목이
// 다섯 개인 사람이 개념 서른 개를 한 번에 마주하지 않도록.
const ROWS_PER_SUBJECT = 5;
// 극복법을 펼친 채로 보여줄 상위 개념 수(전체 순위 기준). 나머지는 눌러서 편다.
const OPEN_BY_DEFAULT = 2;
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
  // 지금 선택된 기간 탭(RANGES.key).
  selectedKey: string;
  // 들어오자마자 극복법을 자동 생성할지(주기당 1회). page.tsx 가 판정한다.
  autoGenerate: boolean;
  // 이번 주 진단 행이 이미 있는지. 있는데 극복법이 없다면 생성이 실패해 pending으로
  // 남은 것이므로 버튼을 "다시 시도"로 보여준다.
  requestedThisWeek: boolean;
}) {
  const maxWrong = Math.max(1, ...agg.concepts.map((c) => c.wrongCount));
  // 전체 순위(1위부터). 목록은 과목별로 끊기지만 "가장 시급한 개념"은 과목을 가로질러
  // 정해진다 — 행마다 순위를 붙여 두 축을 한 화면에서 같이 읽게 한다.
  const rankOf = new Map<ConceptStat, number>();
  agg.concepts.forEach((c, i) => rankOf.set(c, i + 1));
  // 지금 할 일 한 칸: 가장 많이 틀렸으면서 기출 풀기가 가능한 개념.
  const nextUp = agg.concepts.find(
    (c) => c.subjectSlug != null && c.corpusCount >= MIN_CORPUS_FOR_SOLVE,
  );

  return (
    <div className="flex flex-col gap-7">
      {/* 0. 요약 한 줄 — 이 기간에 무슨 일이 있었는지부터. */}
      <p className="text-sm leading-relaxed text-slate-600 dark:text-zinc-400">
        {rangeLabel(agg.window.days)} 동안 <Num>{agg.totals.wrongQuestions}</Num>문항을 틀렸고,
        약점은 <Num>{agg.bySubject.length}</Num>개 과목 <Num>{agg.concepts.length}</Num>개 개념에
        걸쳐 있어요.
        {agg.window.widened && " 선택한 기간에 푼 문제가 없어 기간을 넓혔어요."}
      </p>

      {/* 1. 지금 할 일 한 칸 */}
      {nextUp && (
        <div className="flex flex-col gap-3 rounded-lg border border-slate-200 p-4 dark:border-zinc-800">
          <div>
            <p className="text-xs font-semibold text-slate-500 dark:text-zinc-500">
              가장 많이 틀린 개념부터
            </p>
            <p className="mt-1 text-[15px] font-bold leading-snug text-slate-900 dark:text-zinc-100">
              {nextUp.concept}
            </p>
            <p className="mt-0.5 text-xs tabular-nums text-slate-500 dark:text-zinc-500">
              {[nextUp.subject, `${nextUp.wrongCount}문항 틀림`].filter(Boolean).join(" · ")}
            </p>
          </div>
          <ConceptSolveButton
            concept={nextUp.concept}
            conceptId={nextUp.conceptId}
            subjectSlug={nextUp.subjectSlug as string}
            limit={5}
            label="같은 개념 기출 5문제 풀기"
            variant="primary"
          />
        </div>
      )}

      {/* 2. 극복법 생성 상태(없을 때만) */}
      {!hasCoaching &&
        (autoGenerate ? (
          <DiagnosisAutoGenerate />
        ) : (
          <DiagnosisCoachingButton requestedThisWeek={requestedThisWeek} nextDate={nextDate} />
        ))}

      {/* 3. 기간 탭 + 과목별 개념 목록 (그래프와 카드를 합친 단일 목록) */}
      <section className="flex flex-col gap-5">
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

        <div className="flex flex-col gap-8">
          {agg.bySubject.map((g) => (
            <SubjectSection
              key={g.subjectSlug ?? g.subject}
              group={g}
              maxWrong={maxWrong}
              rankOf={rankOf}
              coachingByConcept={coachingByConcept}
            />
          ))}
        </div>
      </section>

      <p className="text-xs leading-relaxed text-slate-400 dark:text-zinc-600">
        수치는 {rangeLabel(agg.window.days)} 실시간 데이터예요. 맞춤 극복법은 주 1회, 지난
        진단 이후(최대 2주)에 틀린 문제만 분석해요.
        {hasCoaching && nextDate ? ` 다음 진단은 ${formatMonthDay(nextDate)}부터.` : ""}
      </p>
    </div>
  );
}

// 요약 문장 속 숫자. 문장 안에서 숫자만 또렷하게.
function Num({ children }: { children: ReactNode }) {
  return (
    <b className="font-bold tabular-nums text-slate-900 dark:text-zinc-100">{children}</b>
  );
}

// 한 과목 = 목록의 한 덩어리. 상위 몇 개만 펼쳐 두고 나머지는 과목 안에서 접는다.
function SubjectSection({
  group,
  maxWrong,
  rankOf,
  coachingByConcept,
}: {
  group: SubjectConceptGroup;
  maxWrong: number;
  rankOf: Map<ConceptStat, number>;
  coachingByConcept: Map<string, DiagnosisConceptCoaching>;
}) {
  const shown = group.concepts.slice(0, ROWS_PER_SUBJECT);
  const rest = group.concepts.slice(ROWS_PER_SUBJECT);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 border-b border-slate-900 pb-1.5 dark:border-zinc-100">
        <h2 className="text-sm font-bold text-slate-900 dark:text-zinc-100">{group.subject}</h2>
        <span className="text-xs tabular-nums text-slate-500 dark:text-zinc-500">
          {group.totalWrong}문항 틀림 · 개념 {group.concepts.length}개
        </span>
      </div>
      <div className="flex flex-col divide-y divide-slate-200 dark:divide-zinc-800">
        {shown.map((c, i) => (
          <ConceptRow
            key={`${c.concept}-${i}`}
            concept={c}
            rank={rankOf.get(c) ?? null}
            maxWrong={maxWrong}
            coaching={coachingByConcept.get(c.concept) ?? null}
          />
        ))}
      </div>
      {/* 그룹 이름(group/more)을 붙이는 이유: 이 details 안에 개념 행 details 가 또
          들어간다. 이름 없는 group-open 은 열린 조상 아무거나에 걸려서, 이 목록을
          펼치면 안쪽 행의 화살표까지 전부 돌아간다. */}
      {rest.length > 0 && (
        <details className="group/more border-t border-slate-200 dark:border-zinc-800">
          <summary className="cursor-pointer list-none py-2.5 text-xs text-slate-500 transition-colors hover:text-slate-900 dark:text-zinc-500 dark:hover:text-zinc-300 [&::-webkit-details-marker]:hidden">
            <span className="group-open/more:hidden">이 과목 개념 {rest.length}개 더 보기</span>
            <span className="hidden group-open/more:inline">접기</span>
          </summary>
          <div className="flex flex-col divide-y divide-slate-200 border-t border-slate-200 dark:divide-zinc-800 dark:border-zinc-800">
            {rest.map((c, i) => (
              <ConceptRow
                key={`${c.concept}-rest-${i}`}
                concept={c}
                rank={rankOf.get(c) ?? null}
                maxWrong={maxWrong}
                coaching={coachingByConcept.get(c.concept) ?? null}
              />
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

// 개념 한 줄. 접힌 상태에서 보이는 것은 개념 이름·틀린 수·막대뿐이고, 펼치면 그 개념의
// 나머지(정답률·기출 수·극복법·풀기)가 같은 자리에서 이어진다 — 예전처럼 그래프에서
// 이름을 보고 카드에서 같은 이름을 다시 찾을 일이 없다.
//
// 라벨을 막대 위에 두는 건 개념 이름이 길기 때문이다 — 좌측 고정폭에 넣으면 "글의
// 내용과 일치·불일치 판단"이 "글의 내용과 일치…"로 잘려 정작 알아야 할 정보가 사라진다.
// 막대는 이 기간에 틀린 문항 수만 나타낸다(극복 여부는 세지 않는다).
function ConceptRow({
  concept,
  rank,
  maxWrong,
  coaching,
}: {
  concept: ConceptStat;
  // 전체 순위(1위부터). 상위 몇 개는 펼친 채로 연다.
  rank: number | null;
  maxWrong: number;
  coaching: DiagnosisConceptCoaching | null;
}) {
  const pct = Math.max(4, Math.round((concept.wrongCount / maxWrong) * 100));
  const canSolve = concept.subjectSlug != null && concept.corpusCount >= MIN_CORPUS_FOR_SOLVE;
  const meta = [
    concept.answeredCount > 0 ? `이 기간에 푼 문항 ${concept.answeredCount}개` : null,
    concept.accuracyPct != null ? `정답률 ${concept.accuracyPct}%` : null,
    concept.corpusCount > 0 ? `전체 기출 ${concept.corpusCount}문항` : null,
  ].filter(Boolean) as string[];

  return (
    <details className="group/row" open={rank != null && rank <= OPEN_BY_DEFAULT}>
      <summary className="cursor-pointer list-none py-3 [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 text-[13px] leading-snug text-slate-800 dark:text-zinc-200">
            {concept.concept}
          </span>
          <span className="flex shrink-0 items-baseline gap-1.5 text-xs tabular-nums text-slate-400 dark:text-zinc-500">
            <b className="font-semibold text-slate-800 dark:text-zinc-200">
              {concept.wrongCount}
            </b>
            문항
            <ChevronDown
              size={13}
              aria-hidden
              className="translate-y-px text-slate-300 transition-transform group-open/row:rotate-180 dark:text-zinc-600"
            />
          </span>
        </div>
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-slate-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-sm bg-slate-700 dark:bg-zinc-400"
            style={{ width: `${pct}%` }}
          />
        </div>
      </summary>

      <div className="pb-4 pl-0 pt-1">
        {meta.length > 0 && (
          <p className="text-xs tabular-nums text-slate-500 dark:text-zinc-500">
            {meta.join(" · ")}
          </p>
        )}

        {/* AI: 맞춤 극복법(있으면) */}
        {coaching && (
          <div className="mt-2.5 border-l-2 border-slate-200 pl-3.5 dark:border-zinc-700">
            <p className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500">극복법</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
              {coaching.weakPattern}
            </p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700 dark:text-zinc-300">
              {coaching.howToOvercome}
            </p>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
    </details>
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
