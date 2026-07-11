import Link from "next/link";
import { notFound } from "next/navigation";
import { Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPaper } from "../paper-detail-data";
import { getPaperExplanations } from "@/lib/wrong-notes";
import {
  groupRowsBySharedImages,
  WrongNoteQuestionCard,
} from "@/components/wrong-note-question-card";
import { levelColor } from "@/lib/level-colors";
import { examTypeColor } from "@/lib/exam-type-colors";
import { subjectColor } from "@/lib/subject-colors";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) return {};
  return {
    title: `${paper.title} 해설`,
    description: `${paper.title} 전체 문항 해설을 문제 이미지·정답과 함께 열람하세요.`,
  };
}

// 문제지 전체 해설 페이지 ("해설 열기"). 문항 이미지 + 정답 + 해설을 번호순으로
// 죽 읽어 내려가는 열람용 화면이라, 오답노트와 달리 해설을 펼친 채로 보여준다.
export default async function PaperExplanationsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) notFound();

  const supabase = await createClient();
  const questions = await getPaperExplanations(supabase, paper);

  if (questions.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">아직 해설이 등록되지 않은 문제지예요</h1>
        <p className="text-sm text-zinc-500">
          해설이 준비되면 이곳에서 문항별 해설을 볼 수 있어요.
        </p>
        <Link
          href={`/papers/${paper.id}`}
          className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          문제지로 돌아가기
        </Link>
      </div>
    );
  }

  const subject = paper.subjects;
  const examType = paper.exam_types;
  const groups = groupRowsBySharedImages(
    // 열람용 화면이라 "내가 고른 답" 개념이 없다 — selectedChoice는 항상 비워둔다.
    questions.map((q) => ({ ...q, selectedChoice: null })),
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <Link
          href={`/papers/${paper.id}`}
          className="text-sm text-zinc-500 hover:text-blue-600"
        >
          ← 문제지로
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          {paper.level && (
            <span className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}>
              {paper.level}
            </span>
          )}
          {examType && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${examTypeColor(examType.name)}`}
            >
              {examType.name}
            </span>
          )}
          {subject && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
            >
              {subject.name}
            </span>
          )}
        </div>

        <h1 className="text-2xl font-semibold leading-snug">{paper.title} 해설</h1>

        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500">
          <span>{questions.length}문항 해설</span>
          <span className="flex items-center gap-1 text-xs text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            정답
          </span>
        </div>

        {paper.question_count != null && questions.length < paper.question_count && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
            일부 문항({paper.question_count - questions.length}개)의 해설은 아직 준비
            중이에요.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-4">
        {groups.map((group) => (
          <WrongNoteQuestionCard
            key={group.rows[0].questionNumber}
            rows={group.rows}
            images={group.images}
            explanationsOpen
            showSelection={false}
          />
        ))}
      </div>

      <div className="flex gap-2">
        <Link
          href={`/papers/${paper.id}/cbt`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Monitor size={15} />
          온라인에서 풀기
        </Link>
        <Link
          href={`/papers/${paper.id}`}
          className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50"
        >
          문제지로
        </Link>
      </div>
    </div>
  );
}
