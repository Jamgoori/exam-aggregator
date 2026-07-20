import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getSubjectWrongNoteOverview,
  getSubjectWrongNoteQuestions,
} from "@/lib/wrong-notes";
import { SubjectWrongNoteQuestions } from "@/components/subject-wrong-note-questions";
import { SubjectPaperList } from "@/components/subject-paper-list";
import { WrongNoteViewTabs } from "@/components/wrong-note-view-tabs";
import { subjectColor } from "@/lib/subject-colors";

type ViewKey = "papers" | "questions";

// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 화면. 기본 "문제지별"은 문제지
// 요약 카드 목록(누르면 회독별 기록·해설), "문항 모아보기"는 그 과목에서 틀린 문항을
// 문제지 경계 없이 한 목록으로 펼친다. 어느 탭을 보든 다른 탭 데이터는 조회하지 않게
// ?view 쿼리로 서버에서 갈라 렌더한다(회독 많은 계정에서 무거운 문항 조립을 필요할
// 때만 하려는 분리). 전환 중 표시는 WrongNoteViewTabs가 담당한다.
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

  if (view === "questions") {
    const note = await getSubjectWrongNoteQuestions(supabase, user.id, slug);
    if (!note) notFound();
    const hasAny = note.unresolvedCount + note.resolvedCount > 0;
    return (
      <SubjectWrongNoteShell
        subject={note.subject}
        view="questions"
        summary={
          hasAny ? (
            <WrongNoteSummary
              unresolved={note.unresolvedCount}
              resolved={note.resolvedCount}
            />
          ) : null
        }
      >
        <SubjectWrongNoteQuestions
          questions={note.questions}
          unresolvedCount={note.unresolvedCount}
          subjectSlug={slug}
        />
      </SubjectWrongNoteShell>
    );
  }

  const note = await getSubjectWrongNoteOverview(supabase, user.id, slug);
  if (!note) notFound();

  const { subject, papers } = note;
  const totalUnresolved = papers.reduce((sum, p) => sum + p.unresolvedCount, 0);
  const totalResolved = papers.reduce((sum, p) => sum + p.resolvedCount, 0);
  const totalWrong = totalUnresolved + totalResolved;

  return (
    <SubjectWrongNoteShell
      subject={subject}
      view="papers"
      summary={
        totalWrong > 0 ? (
          <WrongNoteSummary
            unresolved={totalUnresolved}
            resolved={totalResolved}
            paperCount={papers.length}
          />
        ) : null
      }
    >
      {totalWrong > 0 && (
        <p className="-mt-1 text-xs text-zinc-400 dark:text-zinc-500">
          시험지를 눌러 회독 기록·해설을 보거나, 아래 버튼으로 바로 다시 풀 수 있어요.
        </p>
      )}

      {papers.length === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500 dark:text-zinc-500">
          이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀면 틀린 문제가
          자동으로 이곳에 모여요.
        </p>
      ) : (
        <SubjectPaperList
          subjectSlug={slug}
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
    </SubjectWrongNoteShell>
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
        <h1 className="text-2xl font-semibold">{subject.name} 오답노트</h1>
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
