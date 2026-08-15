import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPaperWrongNote } from "@/lib/wrong-notes";
import {
  WrongNotePaperView,
  type PaperViewQuestion,
} from "@/components/wrong-note-paper-view";
import { levelColor } from "@/lib/level-colors";
import { paperCbtHref } from "@/lib/paper-href";
import { subjectColor } from "@/lib/subject-colors";
import { isPremium } from "@/lib/membership";
import { MembershipUpsell } from "@/components/membership-upsell";

// 문제지 하나의 오답노트: 회독별 점수 기록(스트립)과 틀린 문제·해설을 한 화면에서
// 본다. 기본은 모든 회독을 합친 "통합" 보기, 회독 칩을 누르면 그 회독만 필터된다.
export default async function PaperWrongNotePage({
  params,
}: {
  params: Promise<{ slug: string; paperId: string }>;
}) {
  const { slug, paperId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/wrong-notes/${slug}/${paperId}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  // 오답노트 열람 자체는 무료다 — 내가 틀린 문항 목록은 내 데이터고, 점수·정답은
  // 회차별 오답 페이지(/mypage/attempts/[id])에서 이미 무료로 보여주고 있다. 멤버십은
  // 해설 본문과 정리·복습 도구에만 건다(해설은 아래 includeExplanations 로 갈린다).
  const premium = await isPremium(supabase, user.id);
  const note = await getPaperWrongNote(supabase, user.id, paperId, premium);
  // 잘못된 주소(다른 과목의 문제지 등)로 들어오면 404.
  if (!note || note.paper.subjects?.slug !== slug) notFound();

  const { paper, rounds, questions, unresolvedCount } = note;
  const subject = paper.subjects!;

  const viewQuestions: PaperViewQuestion[] = questions.map((q) => ({
    questionNumber: q.questionNumber,
    lastSelectedChoice: q.lastSelectedChoice,
    correctChoice: q.correctChoice,
    choiceCount: q.choiceCount,
    images: q.images,
    explanation: q.explanation,
    explanationLocked: q.explanationLocked,
    wrongCount: q.wrongCount,
    resolved: q.resolved,
    pinned: q.pinned,
  }));

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Link
          href={`/mypage/wrong-notes/${slug}`}
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← {subject.name} 오답노트로
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
          >
            {subject.name}
          </span>
          {paper.level && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}
            >
              {paper.level}
            </span>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold leading-snug">{paper.title}</h1>
          <Link
            href={paperCbtHref(paper)}
            className="flex shrink-0 items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
          >
            <Monitor size={12} />
            다시 풀기
          </Link>
        </div>
      </div>

      <WrongNotePaperView
        paperId={paper.id}
        questions={viewQuestions}
        rounds={rounds}
        unresolvedCount={unresolvedCount}
        premium={premium}
        lockNext={`/mypage/wrong-notes/${slug}/${paperId}`}
      />

      {!premium && (
        <MembershipUpsell
          title="해설까지 보면서 복습하려면"
          description="멤버십은 해설을 제한 없이 볼 수 있고, 다시 볼 문제 체크·메모와 복습 일정까지 이어져요."
          next={`/mypage/wrong-notes/${slug}/${paperId}`}
        />
      )}
    </div>
  );
}
