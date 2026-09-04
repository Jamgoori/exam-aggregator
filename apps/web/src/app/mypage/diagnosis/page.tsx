import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { HelpCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getWeeklyDiagnosis,
  getLatestReadyDiagnosis,
  getDiagnosisEligibility,
  nextDiagnosisDate,
  DIAGNOSIS_WINDOW_DAYS,
  type DiagnosisConceptCoaching,
} from "@/lib/ai-diagnosis";
import { getDiagnosisAggregate, type DiagnosisAggregate } from "@/lib/diagnosis-live";
import { DiagnosisBoard } from "./diagnosis-board";
import type { DiagnosisPickerConcept } from "./diagnosis-actions";
import { getExcludedDiagnosisSubjectSlugs } from "@/lib/review-preferences";
import { pickCoachTargets } from "@/lib/diagnosis-generate";
import { conceptSelectionKey } from "@/lib/diagnosis-limits";
import { isPremium } from "@/lib/membership";
import { MembershipLockedPage } from "@/components/membership-upsell";
import { DiagnosisProgress } from "@/components/diagnosis-progress";
import { collectDiagnosisBatches, getPendingDiagnosisBatch } from "@/lib/diagnosis-batch";

// AI 약점 진단. 입장 즉시 보이는 것은 전부 결정적 데이터(무AI):
//  A) 최근 7일에 틀린 개념 막대그래프 — 이번 주에 뭘 틀렸는지 한눈에.
//  B) 맞춤 극복법 — 개념을 골라 요청하면 그 개념들에 대해서만 AI 진단이 붙는다.
//
// 기간(?range=)은 그래프에만 걸린다. 기본은 최근 7일이고, 30일·전체는 "쌓인 오답을
// 넓게 보기"용이다. 극복법이 훑는 기간은 칩과 무관하게 언제나 최근 7일
// (DIAGNOSIS_WINDOW_DAYS)이다 — 그래야 화면·프롬프트·안내가 같은 숫자를 말한다.
//
// 과목(?subject=)은 서버가 거르지 않는다. 전 과목 집계를 한 번 내려주고 화면(클라이언트)이
// 즉시 거른다 — 예전에는 과목 칩이 링크라 누를 때마다 서버 왕복 + 라이브 집계 2회가
// 돌아서 눈에 띄게 느렸다. URL 의 subject 는 기간 칩을 눌러 돌아왔을 때 선택을 살리는
// 용도로만 읽는다.
// 그래프 기간 칩. 기본은 분석 창과 같은 최근 7일이고, 30일·전체는 "쌓인 오답을 넓게
// 보기"용이다(극복법은 칩과 무관하게 늘 7일). 화면이 아니라 여기서 정의하는 이유는
// 서버가 ?range= 를 이 목록으로 검증하기 때문이다 — "use client" 모듈의 상수를 서버가
// 읽으면 클라이언트 참조를 건드려 런타임에 터진다.
const RANGES = [
  {
    key: "7",
    days: DIAGNOSIS_WINDOW_DAYS as number | null,
    label: `최근 ${DIAGNOSIS_WINDOW_DAYS}일`,
  },
  { key: "30", days: 30 as number | null, label: "최근 30일" },
  { key: "all", days: null as number | null, label: "전체" },
];

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

  // AI 약점 진단은 멤버십 기능. 아래 라이브 집계가 계정 전체 오답을 훑는 무거운
  // 작업이라, 못 볼 화면을 위해 돌리지 않도록 집계 전에 판정한다.
  if (!(await isPremium(supabase, user!.id))) {
    return (
      <MembershipLockedPage
        title="AI 약점 진단은 멤버십 기능이에요"
        description="과목별로 어떤 개념에서 주로 틀리는지 그래프로 보여주고, 고른 개념마다 왜 틀렸는지 분석해 맞춤 극복법과 같은 개념 기출 문제를 이어줘요. 지금까지 쌓인 오답은 그대로 남아 있어요."
        backHref="/mypage?tab=wrong-notes"
        backLabel="오답노트로"
        next="/mypage/diagnosis"
      />
    );
  }

  // 데이터층(무AI): 막대그래프. 페이지 입장 즉시 라이브 집계 — 한 번만 돈다.
  const params = await searchParams;
  const range = RANGES.find((r) => r.key === params?.range) ?? RANGES[0];
  const graph = await getDiagnosisAggregate(user.id, { days: range.days });

  // 배치로 만들던 극복법이 끝났으면 여기서 수거한다. 크론(api/cron/diagnosis)이 매시간
  // 같은 일을 하지만, 그걸 기다리면 방금 끝난 결과를 최대 한 시간 늦게 본다. 진행 중인
  // 배치가 있을 때만 부른다 — 아니면 진단 페이지를 열 때마다 Anthropic 왕복이 하나씩
  // 붙는다(수거는 무료 API지만 공짜는 아니다).
  let generating = await getPendingDiagnosisBatch(user.id);
  if (generating) {
    await collectDiagnosisBatches({ userId: user.id });
    generating = await getPendingDiagnosisBatch(user.id);
  }

  // AI 극복법(있으면): 이번 주기 리포트 → 없으면 지난 완료 리포트에서 conceptCoaching만
  // 가져온다. 주기가 풀린 뒤에도 지난 진단은 계속 보인다 — 그 사이 화면이 비면 지난주에
  // 받은 것이 사라진 줄 안다. 다만 언제 것인지는 밝힌다(coachingDate).
  const today = await getWeeklyDiagnosis(supabase, user.id);
  let coaching: DiagnosisConceptCoaching[] | null = today?.report?.conceptCoaching ?? null;
  let coachingDate: string | null = coaching && coaching.length > 0 ? today!.date : null;
  if (!coaching || coaching.length === 0) {
    const latest = await getLatestReadyDiagnosis(supabase, user.id);
    coaching = latest?.report?.conceptCoaching ?? null;
    coachingDate = (coaching ?? []).length > 0 ? (latest?.date ?? null) : null;
  }

  // 주기 안내: 이번 주기에 이미 받았으면 언제 다시 받을 수 있는지 알려준다.
  const nextDate = today ? nextDiagnosisDate(today.date) : null;

  // 극복법이 분석할 집계는 기간 칩과 무관하게 언제나 최근 7일이다. 기본 칩이 그 7일이라
  // 대개는 위에서 만든 집계를 그대로 재사용한다(추가 왕복 없음). 다른 칩을 골랐을 때만
  // 7일치를 따로 집계한다 — 그래프에 보이는 개념과 고를 수 있는 개념이 어긋나면
  // "그래프에 있는데 왜 못 고르지"가 되므로, 선택창이 스스로 기간을 밝힌다.
  //
  // 자동 확장(widened)이 걸린 집계는 쓰지 않는다. widened 는 "그 기간에 틀린 게 없어
  // 기간을 넓혔다"는 뜻이라, 그 개념들을 골라 봐야 생성기가 "최근 7일 오답이 없어요"로
  // 되돌린다.
  const analysisAgg: DiagnosisAggregate | null =
    range.days === DIAGNOSIS_WINDOW_DAYS
      ? graph.window.widened
        ? null
        : graph
      : await getDiagnosisAggregate(user.id, { days: DIAGNOSIS_WINDOW_DAYS, widen: false });

  // 극복법은 자동 생성하지 않는다. 예전에는 페이지 입장만으로 만들었는데, 그러면
  // 사용자가 분석할 개념을 고를 틈이 없다 — 준비하지 않는 개념이 상한(전체 15개)을
  // 차지한 채 요금까지 나간다. 이제 선택창에서 고르고 직접 누른다.
  //
  // 배치가 도는 중이면 선택창을 보여주지 않는다 — 누르면 같은 진단에 두 번 요금이
  // 나가고, 사용자는 자기가 뭘 잘못했나 싶어 계속 누른다.
  //
  // 잠금은 "지난 극복법이 있는지"가 아니라 **이번 주기에 이미 받았는지**로 본다. 예전에는
  // 지난 리포트가 하나라도 있으면 선택창이 영영 사라져서, 주기가 풀려도 다시 받을 길이
  // 화면에서 없어졌다(요청 행이 pending 으로 실패해 남았을 때의 재시도도 마찬가지였다).
  const cycleDone = today?.status === "ready";
  const canGenerate =
    !cycleDone &&
    generating == null &&
    (analysisAgg?.concepts.length ?? 0) > 0 &&
    (await getDiagnosisEligibility(supabase, user.id)).eligible;

  // 선택창(체크박스)에 뿌릴 개념 목록. 미리 체크해 둘 추천은 예전 자동 선정
  // (pickCoachTargets)과 같은 규칙으로 뽑는다 — 그대로 눌렀을 때의 결과가 예전과 같아야,
  // 고르는 일이 "해도 되고 안 해도 되는" 것이 된다.
  let pickerConcepts: DiagnosisPickerConcept[] | null = null;
  if (canGenerate && analysisAgg) {
    const recommendedKeys = new Set(
      pickCoachTargets(
        analysisAgg,
        await getExcludedDiagnosisSubjectSlugs(supabase, user.id),
      ).map(conceptSelectionKey),
    );
    pickerConcepts = analysisAgg.concepts.map((c) => ({
      key: conceptSelectionKey(c),
      concept: c.concept,
      conceptId: c.conceptId,
      subject: c.subject,
      subjectSlug: c.subjectSlug,
      wrongCount: c.wrongCount,
      accuracyPct: c.accuracyPct,
      scoreGainPct: c.scoreGainPct,
      recommended: recommendedKeys.has(conceptSelectionKey(c)),
    }));
  }

  // 과목 탭의 초기 선택. 화면이 클라이언트에서 거르므로 여기서는 값이 실재하는지만 본다.
  const subjectSlug =
    params?.subject && graph.subjects.some((s) => s.slug === params.subject)
      ? params.subject
      : null;

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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl font-bold text-slate-900 dark:text-zinc-100">AI 약점 진단</h1>
            {/* 규칙(주기·분석 기간·상한·자격)은 전용 안내 페이지가 맡는다. 대시보드에
                다 적으면 정작 볼 것이 밀린다. */}
            <Link
              href="/diagnosis"
              className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-500 ring-1 ring-slate-200 transition-colors hover:text-blue-600 dark:bg-zinc-900 dark:text-zinc-400 dark:ring-zinc-800 dark:hover:text-blue-400"
            >
              <HelpCircle size={13} /> 진단 안내
            </Link>
          </div>
        </header>

        {graph.concepts.length === 0 ? (
          <EmptyState supabase={supabase} userId={user.id} />
        ) : (
          <DiagnosisBoard
            window={graph.window}
            bySubject={graph.bySubject}
            concepts={graph.concepts}
            subjects={graph.subjects.map((s) => ({ name: s.name, slug: s.slug }))}
            initialSubject={subjectSlug}
            ranges={RANGES.map((r) => ({ key: r.key, label: r.label }))}
            rangeKey={range.key}
            coaching={coaching ?? []}
            coachingDate={coachingDate}
            picker={pickerConcepts}
            analysisDays={DIAGNOSIS_WINDOW_DAYS}
            requestedThisWeek={today != null}
            nextDate={nextDate}
            generating={generating}
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
      <p className="text-sm text-slate-500 dark:text-zinc-400">
        {eligibility.eligible
          ? "아직 분석할 오답 개념이 없어요. 문제를 조금 더 풀면 여기에 약점이 정리돼요."
          : (eligibility.hint ?? "조금 더 풀면 진단을 받을 수 있어요.")}
      </p>
      {/* 자격 미달이면 "얼마나 남았는지"를 숫자로. 가장 빨리 채우는 길은 CBT 한 회차라
          바를 누르면 문제지 목록으로 간다. */}
      {!eligibility.eligible && (
        <div className="w-full max-w-sm text-left">
          <DiagnosisProgress
            attemptCount={eligibility.attemptCount}
            wrongCount={eligibility.wrongCount}
            lockedHref="/papers"
          />
        </div>
      )}
      <Link
        href={eligibility.eligible ? "/mypage?tab=wrong-notes" : "/papers"}
        className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-700"
      >
        {eligibility.eligible ? "오답노트로 가기" : "문제 풀러 가기"}
      </Link>
    </Card>
  );
}
