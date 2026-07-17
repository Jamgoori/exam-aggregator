import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getSubjectWrongNoteOverview,
  getSubjectWrongNoteQuestions,
} from "@/lib/wrong-notes";
import { SubjectWrongNoteQuestions } from "@/components/subject-wrong-note-questions";
import { SubjectPaperList } from "@/components/subject-paper-list";
import { subjectColor } from "@/lib/subject-colors";

type ViewKey = "papers" | "questions";

// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 화면. 기본 "문제지별"은 문제지
// 요약 카드 목록(누르면 회독별 기록·해설), "문항 모아보기"는 그 과목에서 틀린 문항을
// 문제지 경계 없이 한 목록으로 펼친다. 어느 탭을 보든 다른 탭 데이터는 조회하지 않게
// ?view 쿼리로 서버에서 갈라 렌더한다(회독 많은 계정에서 무거운 문항 조립을 필요할
// 때만 하려는 분리).
export default async function SubjectWrongNotePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ view?: string; concept?: string }>;
}) {
  const { slug } = await params;
  const { view: viewParam, concept } = await searchParams;
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
    return (
      <SubjectWrongNoteShell subject={note.subject} view="questions">
        <SubjectWrongNoteQuestions
          questions={note.questions}
          unresolvedCount={note.unresolvedCount}
          subjectSlug={slug}
          initialConcept={concept}
        />
      </SubjectWrongNoteShell>
    );
  }

  const note = await getSubjectWrongNoteOverview(supabase, user.id, slug);
  if (!note) notFound();

  const { subject, papers } = note;
  const totalWrong = papers.reduce(
    (sum, p) => sum + p.unresolvedCount + p.resolvedCount,
    0,
  );

  return (
    <SubjectWrongNoteShell subject={subject} view="papers">
      {totalWrong > 0 && (
        <p className="-mt-2 text-sm text-zinc-500 dark:text-zinc-500">
          시험지마다 &lsquo;틀린 문제 다시 풀기&rsquo;로 바로 풀 수 있어요. 여러 시험지를
          체크하면 합쳐서 풀 수 있고, 시험지를 누르면 회독·해설을 볼 수 있어요.
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
          }))}
        />
      )}
    </SubjectWrongNoteShell>
  );
}

// 헤더(뒤로가기·과목 배지·제목) + 탭 링크를 두 뷰가 공유한다. 탭은 ?view 쿼리를
// 바꾸는 링크라 서버에서 해당 뷰만 조회한다.
function SubjectWrongNoteShell({
  subject,
  view,
  children,
}: {
  subject: { slug: string; name: string };
  view: ViewKey;
  children: React.ReactNode;
}) {
  const base = `/mypage/wrong-notes/${subject.slug}`;
  const tab = (key: ViewKey, label: string, href: string) => (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        view === key
          ? "bg-blue-600 text-white"
          : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-12">
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
        <div className="flex gap-2">
          {tab("papers", "문제지별", base)}
          {tab("questions", "문항 모아보기", `${base}?view=questions`)}
        </div>
      </div>
      {children}
    </div>
  );
}
