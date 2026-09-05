import { cache, Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Shuffle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import {
  getSubjectBySlug,
  getSubjectWrongNoteOverview,
  getSubjectWrongNoteQuestions,
} from "@/lib/wrong-notes";
import { SubjectWrongNoteQuestions } from "@/components/subject-wrong-note-questions";
import { SubjectPaperList } from "@/components/subject-paper-list";
import { WrongNoteViewTabs } from "@/components/wrong-note-view-tabs";
import { MixSessionList } from "@/components/mix-session-list";
import { listMixSessions } from "@/lib/mix-practice";
import { subjectColor } from "@/lib/subject-colors";
import { isPremium } from "@/lib/membership";

type ViewKey = "papers" | "questions";

// 요약 스탯과 목록은 같은 조회 결과를 쓰는데 화면에서 떨어져 있어(탭 줄이 사이에
// 낀다) 각자 따로 기다려야 한다. 같은 요청 안에서는 한 번만 조회되도록 감싼다.
const loadQuestions = cache(getSubjectWrongNoteQuestions);
const loadOverview = cache(getSubjectWrongNoteOverview);
const loadMixSessions = cache(listMixSessions);

// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 화면. 기본 "문제지별"은 문제지
// 요약 카드 목록(누르면 회독별 기록·해설), "문항 모아보기"는 그 과목에서 틀린 문항을
// 문제지 경계 없이 한 목록으로 펼친다. 어느 탭을 보든 다른 탭 데이터는 조회하지 않게
// ?view 쿼리로 서버에서 갈라 렌더한다(회독 많은 계정에서 무거운 문항 조립을 필요할
// 때만 하려는 분리). 전환 중 표시는 WrongNoteViewTabs가 담당한다.
//
// 오답이 많이 쌓인 과목은 집계에 시간이 걸리는데, 예전에는 그게 끝날 때까지 화면에
// 아무것도 나오지 않았다. 지금은 과목명·탭 같은 뼈대를 먼저 보여주고(가벼운 과목
// 조회만 기다린다), 요약 스탯과 목록만 준비되는 대로 채운다 — 기다리는 동안에도
// 탭을 바로 누를 수 있다.
export default async function SubjectWrongNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  const { slug } = await params;
  const { view: viewParam } = await searchParams;
  const view: ViewKey = viewParam === "questions" ? "questions" : "papers";
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const subject = await getSubjectBySlug(supabase, slug);
  if (!subject) notFound();

  // 오답노트는 무료다 — 열람도, 메모·다시 볼 문제 정리도, 섞어풀기도. 내가 틀린
  // 문제를 내가 다시 보는 일이라 막지 않는다. 여기서 멤버십을 확인하는 건 해설
  // 본문을 조회할지 정하기 위해서다(무료 회원에게는 잠금 자리만 내려간다).
  const premium = await isPremium(supabase, user.id);

  return (
    <SubjectWrongNoteShell
      subject={subject}
      view={view}
      summary={
        <Suspense fallback={<SummarySkeleton />}>
          {view === "questions" ? (
            <QuestionsSummary
              supabase={supabase}
              userId={user.id}
              slug={slug}
              premium={premium}
            />
          ) : (
            <PapersSummary
              supabase={supabase}
              userId={user.id}
              slug={slug}
              premium={premium}
            />
          )}
        </Suspense>
      }
    >
      <Suspense fallback={<ListSkeleton />}>
        {view === "questions" ? (
          <QuestionsView
            supabase={supabase}
            userId={user.id}
            slug={slug}
            premium={premium}
          />
        ) : (
          <PapersView
            supabase={supabase}
            userId={user.id}
            slug={slug}
            premium={premium}
          />
        )}
      </Suspense>
    </SubjectWrongNoteShell>
  );
}

type ViewProps = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  slug: string;
  premium: boolean;
};

async function QuestionsSummary({ supabase, userId, slug, premium }: ViewProps) {
  const note = await loadQuestions(supabase, userId, slug, premium);
  if (!note || note.unresolvedCount + note.resolvedCount === 0) return null;
  return (
    <WrongNoteSummary unresolved={note.unresolvedCount} resolved={note.resolvedCount} />
  );
}

async function QuestionsView({ supabase, userId, slug, premium }: ViewProps) {
  const note = await loadQuestions(supabase, userId, slug, premium);
  if (!note) notFound();
  return (
    <SubjectWrongNoteQuestions
      questions={note.questions}
      unresolvedCount={note.unresolvedCount}
      subjectSlug={slug}
    />
  );
}

async function PapersSummary({ supabase, userId, slug }: ViewProps) {
  const note = await loadOverview(supabase, userId, slug);
  if (!note) return null;
  const totalUnresolved = note.papers.reduce((sum, p) => sum + p.unresolvedCount, 0);
  const totalResolved = note.papers.reduce((sum, p) => sum + p.resolvedCount, 0);
  if (totalUnresolved + totalResolved === 0) return null;
  return (
    <WrongNoteSummary
      unresolved={totalUnresolved}
      resolved={totalResolved}
      paperCount={note.papers.length}
    />
  );
}

async function PapersView({ supabase, userId, slug, premium }: ViewProps) {
  const note = await loadOverview(supabase, userId, slug);
  if (!note) notFound();

  const { papers } = note;
  const totalWrong = papers.reduce(
    (sum, p) => sum + p.unresolvedCount + p.resolvedCount,
    0,
  );
  // 기출 섞어풀기 기록("9월 5일 섞어풀기")은 문제지 카드와 같은 층위다 — 그날 섞어 푼
  // 문항 묶음이 문제지 한 장 자리를 차지한다. 최신 기록이 위로 오게 문제지보다 먼저.
  const mixSessions = await loadMixSessions(supabase, userId, note.subject.id);

  return (
    <>
      {totalWrong > 0 && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">
          {premium
            ? "시험지를 눌러 회독 기록·해설을 보거나, 아래 버튼으로 바로 다시 풀 수 있어요."
            : "시험지를 눌러 회독 기록·틀린 문항을 보거나, 아래 버튼으로 바로 다시 풀 수 있어요."}
        </p>
      )}

      {mixSessions.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              <Shuffle size={14} className="text-blue-600 dark:text-blue-400" />
              섞어풀기 기록
            </h2>
            <span className="text-xs text-zinc-400 dark:text-zinc-600">{mixSessions.length}회</span>
          </div>
          <MixSessionList subjectSlug={slug} sessions={mixSessions} />
        </section>
      )}

      {papers.length === 0 ? (
        mixSessions.length === 0 ? (
          <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
            이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀거나 위의 기출 섞어풀기를
            하면 틀린 문제가 자동으로 이곳에 모여요.
          </p>
        ) : null
      ) : (
        <SubjectPaperList
          subjectSlug={slug}
          heading={mixSessions.length > 0 ? "시험지별" : undefined}
          papers={papers.map((p) => ({
            paperId: p.paper.id,
            title: p.paper.title,
            level: p.paper.level,
            attemptCount: p.attemptCount,
            latestScore: p.latestScore,
            latestTotal: p.latestTotal,
            lastAttemptAt: p.lastAttemptAt,
            unresolved: p.unresolvedCount,
            resolved: p.resolvedCount,
          }))}
        />
      )}
    </>
  );
}

// 기다리는 동안 자리를 잡아두는 뼈대. 실제 내용이 도착하면 그 자리에 그대로 들어차서
// 화면이 위아래로 튀지 않는다(loading.tsx와 같은 skeleton 스타일).
function SummarySkeleton() {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
      <div className="skeleton h-10 w-20 rounded-lg" />
      <span className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
      <div className="skeleton h-10 w-20 rounded-lg" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex flex-col gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700"
        >
          <div className="flex items-center gap-2">
            <div className="skeleton h-5 w-10 rounded" />
            <div className="skeleton h-5 w-56 rounded-lg" />
          </div>
          <div className="flex items-center gap-3">
            <div className="skeleton h-4 w-14 rounded-full" />
            <div className="skeleton h-4 w-24 rounded-lg" />
            <div className="skeleton h-4 w-28 rounded-lg" />
          </div>
        </div>
      ))}
    </div>
  );
}

// 헤더(뒤로가기·과목 배지·제목) + 과목 요약 스탯 + 뷰 탭을 두 뷰가 공유한다.
// 요약(남은 오답·극복·시험지)은 탭 위에 두어, 들어오자마자 "얼마나 남았나"를
// 먼저 읽게 한다. 탭 전환은 WrongNoteViewTabs(클라이언트)가 맡는다.
function SubjectWrongNoteShell({
  subject,
  view,
  summary,
  children,
}: {
  subject: { slug: string; name: string };
  view: ViewKey;
  summary?: React.ReactNode;
  children: React.ReactNode;
}) {
  const base = `/mypage/wrong-notes/${subject.slug}`;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/mypage?tab=wrong-notes"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 오답노트로
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
          >
            {subject.name}
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">{subject.name} 오답노트</h1>
          {/* 기출 섞어풀기 입구. 이 과목의 기출 전체에서 새 문제를 뽑는 기능이라 오답
              유무와 무관하게 언제나 보인다 — 오답이 0인 과목도 여기서 시작할 수 있다. */}
          <Link
            href={`/subjects/${subject.slug}/mix`}
            className="flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
          >
            <Shuffle size={12} />
            기출 섞어풀기
          </Link>
        </div>
      </div>
      {summary}
      <WrongNoteViewTabs view={view} base={base}>
        {children}
      </WrongNoteViewTabs>
    </div>
  );
}

// 과목 전체 진행 요약 바. 남은 오답(빨강)을 가장 먼저, 극복(초록), 시험지 수 순으로
// 라벨과 함께 큼직하게 보여 준다. 시험지 수는 "문제지별" 뷰에서만 의미가 있어 옵션.
function WrongNoteSummary({
  unresolved,
  resolved,
  paperCount,
}: {
  unresolved: number;
  resolved: number;
  paperCount?: number;
}) {
  return (
    <div className="flex items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
      <SummaryStat
        label="남은 오답"
        value={unresolved}
        unit="문항"
        color="text-red-600 dark:text-red-400"
      />
      <span className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
      <SummaryStat
        label="극복"
        value={resolved}
        unit="문항"
        color="text-emerald-600 dark:text-emerald-400"
      />
      {paperCount != null && (
        <>
          <span className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
          <SummaryStat
            label="시험지"
            value={paperCount}
            unit="장"
            color="text-zinc-700 dark:text-zinc-200"
          />
        </>
      )}
    </div>
  );
}

function SummaryStat({
  label,
  value,
  unit,
  color,
}: {
  label: string;
  value: number;
  unit: string;
  color: string;
}) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] font-semibold tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </span>
      <span className={`mt-0.5 text-2xl font-extrabold leading-none ${color}`}>
        {value}
        <span className="ml-0.5 text-sm font-medium text-zinc-400 dark:text-zinc-500">
          {unit}
        </span>
      </span>
    </div>
  );
}
