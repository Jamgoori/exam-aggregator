import Link from "next/link";
import { notFound } from "next/navigation";
import { Hourglass, LockKeyhole, Monitor } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getPaper } from "../paper-detail-data";
import { getPaperExplanations } from "@/lib/wrong-notes";
import {
  groupRowsBySharedImages,
  WrongNoteQuestionCard,
} from "@/components/wrong-note-question-card";
import { PrintButton } from "@/components/print-button";
import { ExplanationAutoPrint } from "@/components/explanation-auto-print";
import { checkExplanationAccess } from "@/lib/explanation-rate-limit";
import { levelColor } from "@/lib/level-colors";
import { examTypeColor } from "@/lib/exam-type-colors";
import { subjectColor } from "@/lib/subject-colors";
import { getPaperDisplayTitle } from "@/lib/paper-title";
import type { Metadata } from "next";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const paper = await getPaper(id);
  if (!paper) return {};
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);
  return {
    title: `${displayTitle} 해설`,
    description: `${displayTitle} 전체 문항 해설을 문제 이미지·정답과 함께 열람하세요.`,
  };
}

// 비로그인 사용자에게 실제로 렌더링해주는 해설 카드 수. 해설은 이 서비스가 직접
// 만드는 자산이라 익명 크롤링에 통째로 내주지 않는다 — 나머지 문항은 CSS로 가리는
// 게 아니라 서버가 HTML에 아예 담지 않는다.
const ANON_PREVIEW_CARDS = 2;

// 문제지 전체 해설 페이지 ("해설 열기"). 문항 이미지 + 정답 + 해설을 번호순으로
// 죽 읽어 내려가는 열람용 화면이라, 오답노트와 달리 해설을 펼친 채로 보여준다.
export default async function PaperExplanationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ download?: string }>;
}) {
  const { id } = await params;
  const { download } = await searchParams;
  const isDownload = download === "1";
  const paper = await getPaper(id);
  if (!paper) notFound();
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const loggedIn = !!user;

  // 로그인 사용자만 레이트리밋 대상이다 — 비로그인은 어차피 미리보기만 보이므로
  // 별도로 셀 필요가 없다. 상세페이지의 "해설 열기"/"다운로드" 아이콘이 각각
  // view/download로 들어오므로, 같은 사람이라도 두 한도가 독립적으로 소진된다.
  const withinRateLimit = loggedIn
    ? await checkExplanationAccess(user!.id, paper.id, isDownload ? "download" : "view")
    : true;
  const hasFullAccess = loggedIn && withinRateLimit;

  const questions = await getPaperExplanations(supabase, paper);

  if (questions.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">아직 해설이 등록되지 않은 문제지예요</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
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

  // 비로그인이거나 시간당 한도를 넘긴 요청은 미리보기 카드까지만 서버가
  // 렌더링한다 (나머지는 응답에 포함 안 됨 — CSS로 가리는 게 아니다).
  const visibleGroups = hasFullAccess ? groups : groups.slice(0, ANON_PREVIEW_CARDS);
  const hiddenQuestionCount =
    questions.length - visibleGroups.reduce((sum, g) => sum + g.rows.length, 0);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-12 print:max-w-none print:gap-4 print:py-0">
      {hasFullAccess && isDownload && <ExplanationAutoPrint />}

      <div className="flex flex-col gap-3">
        <Link
          href={`/papers/${paper.id}`}
          className="text-sm text-zinc-500 hover:text-blue-600 print:hidden dark:text-zinc-500 dark:hover:text-blue-400"
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

        <h1 className="text-2xl font-semibold leading-snug">{displayTitle} 해설</h1>

        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 dark:text-zinc-500">
          <span>{questions.length}문항 해설</span>
          <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            정답
          </span>
          {hasFullAccess && (
            <span className="ml-auto">
              <PrintButton />
            </span>
          )}
        </div>

        {paper.question_count != null && questions.length < paper.question_count && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            일부 문항({paper.question_count - questions.length}개)의 해설은 아직 준비
            중이에요.
          </p>
        )}
      </div>

      {/* 인쇄(PDF 저장): 원본 시험지처럼 한 페이지를 좌우 2단으로 나눠 채운다
          (CSS multi-column — flex를 print에서 block+columns-2로 전환하고, flex
          gap 대신 카드 쪽 print:mb로 간격을 준다). 페이지/단 나눔은 카드 단위가
          아니라 카드 안의 작은 블록 단위(이미지·답 줄·해설 항목,
          wrong-note-question-card.tsx의 break-inside-avoid)로 제어한다 — 카드
          전체에 avoid를 걸면 긴 카드가 통째로 다음 단으로 밀리며 반 단씩 비기
          때문. 화면 표시에는 아무 영향 없음. */}
      <div className="flex flex-col gap-4 print:block print:columns-2 print:gap-x-6 print:[column-rule:1px_solid_#e4e4e7]">
        {visibleGroups.map((group) => (
          <WrongNoteQuestionCard
            key={group.rows[0].questionNumber}
            rows={group.rows}
            images={group.images}
            explanationsOpen
            showSelection={false}
            eagerImages
          />
        ))}
      </div>

      {!hasFullAccess && hiddenQuestionCount > 0 && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-6 py-10 text-center dark:border-blue-900 dark:bg-blue-950/30">
          {loggedIn ? (
            <>
              {/* 시간당 한도 초과: 로그인은 돼 있으니 로그인 유도 대신 "잠시 후"로만
                  완만하게 안내한다 — 정상 사용자는 이 문구 자체를 볼 일이 없다. */}
              <Hourglass size={28} className="text-blue-600 dark:text-blue-400" />
              <p className="font-semibold">잠시 후 다시 시도해주세요</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                요청이 많아 전체 해설 표시가 일시적으로 제한됐어요.
              </p>
            </>
          ) : (
            <>
              <LockKeyhole size={28} className="text-blue-600 dark:text-blue-400" />
              <p className="font-semibold">
                나머지 {hiddenQuestionCount}문항 해설은 로그인하면 볼 수 있어요
              </p>
              <p className="text-sm text-zinc-500 dark:text-zinc-500">
                무료로 가입하고 전체 해설과 오답노트까지 이용해보세요.
              </p>
              <Link
                href={`/login?next=${encodeURIComponent(`/papers/${paper.id}/explanations`)}`}
                className="mt-1 rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                로그인하고 전체 해설 보기
              </Link>
            </>
          )}
        </div>
      )}

      <div className="flex gap-2 print:hidden">
        <Link
          href={`/papers/${paper.id}/cbt`}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Monitor size={15} />
          온라인에서 풀기
        </Link>
        <Link
          href={`/papers/${paper.id}`}
          className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
        >
          문제지로
        </Link>
      </div>
    </div>
  );
}
