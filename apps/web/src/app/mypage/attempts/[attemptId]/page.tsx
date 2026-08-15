import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Monitor, PartyPopper } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getAttemptWrongNote } from "@/lib/wrong-notes";
import {
  groupRowsBySharedImages,
  WrongNoteLegend,
  WrongNoteQuestionCard,
} from "@/components/wrong-note-question-card";
import { formatDuration } from "@gongmoa/core";
import { levelColor } from "@/lib/level-colors";
import { paperHref, paperCbtHref } from "@/lib/paper-href";
import { examTypeColor } from "@/lib/exam-type-colors";
import { subjectColor } from "@/lib/subject-colors";
import { isPremium } from "@/lib/membership";
import { MembershipUpsell } from "@/components/membership-upsell";

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 내 시험 기록에서 회차 하나를 눌렀을 때 나오는 "그 회차에서 틀린 문제만" 모아보는
// 페이지. 문제지 상세로 바로 보내는 대신, 방금(또는 예전에) 틀린 것부터 복습하게 한다.
export default async function AttemptWrongNotePage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const { attemptId } = await params;
  if (!isUuid(attemptId)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(
      `/login?next=${encodeURIComponent(`/mypage/attempts/${attemptId}`)}&error=${encodeURIComponent("로그인이 필요해요")}`,
    );
  }

  // 점수·틀린 문항 확인은 CBT의 일부라 무료 회원에게도 그대로 열어둔다. 해설만
  // 멤버십 기준을 따른다 — 여기서 전부 내주면 "무료는 하루 문제지 3개"라는 한도가
  // 이 화면으로 통째로 새고, 해설 페이지의 한도만 지키는 셈이 된다.
  const premium = await isPremium(supabase, user.id);
  const note = await getAttemptWrongNote(supabase, user.id, attemptId, premium);
  if (!note) notFound();

  const { attempt, paper, questions } = note;
  const pct =
    attempt.totalQuestions > 0
      ? Math.round((attempt.score / attempt.totalQuestions) * 100)
      : 0;
  const groups = groupRowsBySharedImages(questions);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 pb-12 pt-6 sm:pt-8">
      <div className="flex flex-col gap-3">
        <Link
          href="/mypage?tab=history"
          className="text-sm text-zinc-500 hover:text-blue-600 dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 내 시험 기록으로
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {paper?.level && (
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}>
              {paper.level}
            </span>
          )}
          {paper?.exam_types && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${examTypeColor(paper.exam_types.name)}`}
            >
              {paper.exam_types.name}
            </span>
          )}
          {paper?.subjects && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(paper.subjects.slug)}`}
            >
              {paper.subjects.name}
            </span>
          )}
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500">
            {attempt.round}회독
          </span>
        </div>

        {paper ? (
          <h1 className="text-2xl font-semibold leading-snug">
            <Link href={paperHref(paper)} className="hover:text-blue-600 dark:hover:text-blue-400">
              {paper.title}
            </Link>
          </h1>
        ) : (
          <h1 className="text-2xl font-semibold text-zinc-400 dark:text-zinc-600">삭제된 문제지</h1>
        )}

        <span className="text-sm text-zinc-500 dark:text-zinc-500">
          {new Date(attempt.createdAt).toLocaleDateString("ko-KR")} 응시
          {attempt.durationSeconds != null &&
            ` · ${formatDuration(attempt.durationSeconds)}`}
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">점수</span>
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-semibold">{pct}점</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-600">
              {attempt.score}/{attempt.totalQuestions}
            </span>
          </div>
        </div>
        <div className="flex min-w-[7rem] flex-1 flex-col gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <span className="text-xs text-zinc-500 dark:text-zinc-500">오답</span>
          <span
            className={`text-xl font-semibold ${questions.length > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}
          >
            {questions.length}문제
          </span>
        </div>
      </div>

      {questions.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 py-16 text-center dark:border-zinc-700">
          <PartyPopper size={32} className="text-amber-500" />
          <p className="font-semibold">이 회차는 모두 맞혔어요!</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500">복습할 오답이 없어요. 다음 회차도 파이팅!</p>
        </div>
      ) : (
        <section className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">이 회차에서 틀린 문제 ({questions.length})</h2>
            <WrongNoteLegend />
          </div>
          <div className="flex flex-col gap-4">
            {groups.map((group) => (
              <WrongNoteQuestionCard
                key={group.rows[0].questionNumber}
                rows={group.rows}
                images={group.images}
                explanationLockNext={`/mypage/attempts/${attemptId}`}
              />
            ))}
          </div>
          {!premium && (
            <MembershipUpsell
              title="이 문항들의 해설이 궁금하다면"
              description="멤버십은 해설을 제한 없이 볼 수 있고, 과목별 오답노트에 메모·다시 볼 문제를 붙여 복습 일정까지 이어갈 수 있어요."
              next={`/mypage/attempts/${attemptId}`}
            />
          )}
        </section>
      )}

      {paper && (
        <div className="flex gap-2">
          <Link
            href={paperCbtHref(paper)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Monitor size={15} />
            다시 풀기
          </Link>
          <Link
            href={paperHref(paper)}
            className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          >
            문제지 상세
          </Link>
        </div>
      )}
    </div>
  );
}
