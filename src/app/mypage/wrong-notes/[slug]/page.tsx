import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSubjectWrongNote } from "@/lib/wrong-notes";
import { groupRowsBySharedImages, WrongNoteLegend } from "@/components/wrong-note-question-card";
import {
  WrongNoteSubjectList,
  type WrongNoteListPaper,
} from "@/components/wrong-note-subject-list";
import { subjectColor } from "@/lib/subject-colors";

// 마이페이지 오답노트 탭에서 과목 하나를 골랐을 때 나오는 "과목별 오답 모아보기".
// 여러 문제지에 흩어진 오답을 한 화면에서 죽 넘겨보며 복습하는 용도다.
export default async function SubjectWrongNotePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  const note = await getSubjectWrongNote(supabase, user.id, slug);
  if (!note) notFound();

  const { subject, papers } = note;
  const totalWrong = papers.reduce((sum, p) => sum + p.questions.length, 0);
  const totalUnresolved = papers.reduce((sum, p) => sum + p.unresolvedCount, 0);

  const listPapers: WrongNoteListPaper[] = papers.map((p) => ({
    paperId: p.paper.id,
    title: p.paper.title,
    level: p.paper.level,
    attemptCount: p.attemptCount,
    unresolvedCount: p.unresolvedCount,
    resolvedCount: p.resolvedCount,
    groups: groupRowsBySharedImages(p.questions).map((g) => ({
      images: g.images,
      rows: g.rows.map((q) => ({
        questionNumber: q.questionNumber,
        selectedChoice: q.lastSelectedChoice,
        correctChoice: q.correctChoice,
        choiceCount: q.choiceCount,
        explanation: q.explanation,
        wrongCount: q.wrongCount,
        resolved: q.resolved,
      })),
    })),
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Link
          href="/mypage?tab=wrong-notes"
          className="text-sm text-zinc-500 hover:text-blue-600"
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
        {totalWrong > 0 && (
          <p className="text-sm text-zinc-500">
            지금까지 틀려본 문제 {totalWrong}개 중 {totalWrong - totalUnresolved}개를
            극복했어요. 가장 최근 응시에서도 틀린 문제는{" "}
            <span className="font-medium text-red-600">오답</span>, 다시 풀어서 맞힌
            문제는 <span className="font-medium text-emerald-600">극복</span>으로
            표시돼요.
          </p>
        )}
      </div>

      {totalWrong === 0 ? (
        <p className="py-16 text-center text-sm text-zinc-500">
          이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀면 틀린 문제가
          자동으로 이곳에 모여요.
        </p>
      ) : (
        <>
          <WrongNoteLegend />
          <WrongNoteSubjectList papers={listPapers} />
        </>
      )}
    </div>
  );
}
