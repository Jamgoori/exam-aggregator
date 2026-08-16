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
import { resolveExplanationAccess } from "@/lib/explanation-rate-limit";
import { isPremium } from "@/lib/membership";
import { MembershipUpsell } from "@/components/membership-upsell";
import { FREE_EXPLANATION_DAILY_PAPERS } from "@gongmoa/core";
import { levelColor } from "@/lib/level-colors";
import { examTypeColor } from "@/lib/exam-type-colors";
import { subjectColor } from "@/lib/subject-colors";
import { getPaperDisplayTitle, getSubjectDisplayName } from "@/lib/paper-title";
import { paperHref, paperCbtHref, paperExplanationsHref } from "@/lib/paper-href";
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
    // ?download=1로 열면 인쇄창만 뜰 뿐 내용이 같으므로 정본은 파라미터 없는 주소다.
    alternates: { canonical: paperExplanationsHref(paper) },
    // 비로그인(=크롤러)에게는 아래 ANON_PREVIEW_CARDS만큼만 렌더링되는 미리보기라,
    // 색인되면 내용이 거의 없는 페이지가 문제지 수만큼 늘어나 사이트 전체 평가를
    // 끌어내린다. 사이트맵에서 빼는 것만으로는 막히지 않는다 — 문제지 상세의
    // "해설 열기" 링크를 타고 크롤러가 들어오기 때문에 여기서 못 박아야 한다.
    // follow는 남겨서 이 페이지의 링크(문제지 상세)는 계속 따라가게 한다.
    robots: { index: false, follow: true },
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

  // 로그인 사용자만 한도 판정 대상이다 — 비로그인은 어차피 미리보기만 보이므로
  // 별도로 셀 필요가 없다. 상세페이지의 "해설 열기"/"다운로드" 아이콘이 각각
  // view/download로 들어오므로, 같은 사람이라도 시간당 한도는 독립적으로 소진된다.
  // 무료 회원의 하루 몫은 반대로 둘을 합쳐 문제지 단위로 센다 — "이 문제지 해설을
  // 오늘 봤는가"가 기준이라, 같은 문제지를 열람했다가 내려받는 건 한 개다.
  const access = loggedIn
    ? await resolveExplanationAccess({
        userId: user!.id,
        paperId: paper.id,
        action: isDownload ? "download" : "view",
        premium: await isPremium(supabase, user!.id),
      })
    : null;
  const hasFullAccess = loggedIn && access!.full;

  const questions = await getPaperExplanations(supabase, paper);

  if (questions.length === 0) {
    return (
      <div className="mx-auto flex max-w-lg flex-col items-center gap-4 px-4 py-24 text-center">
        <h1 className="text-xl font-semibold">아직 해설이 등록되지 않은 문제지예요</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          해설이 준비되면 이곳에서 문항별 해설을 볼 수 있어요.
        </p>
        <Link
          href={paperHref(paper)}
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
          href={paperHref(paper)}
          className="text-sm text-zinc-500 hover:text-blue-600 print:hidden dark:text-zinc-500 dark:hover:text-blue-400"
        >
          ← 문제지로
        </Link>

        {/* 급수/시험/과목 뱃지 줄 — 인쇄물에서는 제목에 다 있는 정보라 숨긴다. */}
        <div className="flex flex-wrap items-center gap-2 print:hidden">
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
              {/* 이 문제지의 과목명이라 시행처 표기를 따른다(군무원 → 행정법). */}
              {getSubjectDisplayName(subject.name, examType?.name)}
            </span>
          )}
        </div>

        {/* 인쇄 시 대제목은 화면(24px=18pt)보다 4pt 작게. */}
        <h1 className="text-2xl font-semibold leading-snug print:text-[14pt]">
          {displayTitle} 해설
        </h1>

        {/* "N문항 해설" 줄 — 버튼·범례 포함 전부 화면 전용이라 인쇄에서 통째로 숨긴다. */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 print:hidden dark:text-zinc-500">
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

        {/* 무료 회원에게만 오늘 남은 몫을 알린다. 다 쓴 뒤에 처음 알게 되면
            "왜 갑자기 막혔지"가 되므로, 열람에 성공한 화면에서 미리 보여준다.
            유료·관리자는 remainingToday가 null이라 이 줄이 아예 없다. */}
        {hasFullAccess && access?.remainingToday != null && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-500 print:hidden dark:bg-zinc-800/50 dark:text-zinc-400">
            <span>
              오늘 남은 무료 해설{" "}
              <span className="font-bold text-zinc-700 dark:text-zinc-200">
                {access.remainingToday}개
              </span>{" "}
              · 오늘 열어본 문제지는 다시 봐도 차감되지 않아요
            </span>
            <Link
              href="/membership"
              className="font-medium text-blue-600 hover:underline dark:text-blue-400"
            >
              제한 없이 보기 →
            </Link>
          </p>
        )}

        {paper.question_count != null && questions.length < paper.question_count && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
            일부 문항({paper.question_count - questions.length}개)의 해설은 아직 준비
            중이에요.
          </p>
        )}
      </div>

      {/* 인쇄(PDF 저장): 카드를 좌우 2단 그리드로 채운다. CSS 멀티컬럼(columns-2)은
          크롬이 인쇄에서 균형 배치를 페이지 단위로 처리하지 못해 오른쪽 단이 통째로
          비는 버그가 있어(#96~#99 반복 재발) 폐기. 대신 grid-cols-2 + 기본
          가로우선 배치(grid-auto-flow: row)를 쓰면 카드가 1·2번(윗줄) → 3·4번
          (아랫줄) 순서로 좌→우, 위→아래로 읽히고 페이지도 그 순서로 넘어간다.
          items-start로 한 줄의 짧은 카드가 옆 카드 높이만큼 늘어나지 않게 한다.
          줄 간격은 카드의 print:mb-3가 준다. */}
      <div className="flex flex-col gap-4 print:grid print:grid-cols-2 print:items-start print:gap-x-6">
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

      {!hasFullAccess && hiddenQuestionCount > 0 && access?.reason === "free-quota" && (
        <MembershipUpsell
          title="오늘 무료로 볼 수 있는 해설을 다 봤어요"
          description={`무료 회원은 하루에 문제지 ${FREE_EXPLANATION_DAILY_PAPERS}개까지 해설을 볼 수 있어요. 오늘 이미 열어본 문제지는 계속 다시 볼 수 있고, 매일 자정(한국 시간)에 다시 ${FREE_EXPLANATION_DAILY_PAPERS}개가 열려요. 멤버십은 해설을 제한 없이 볼 수 있어요.`}
          next={paperExplanationsHref(paper)}
        />
      )}

      {!hasFullAccess && hiddenQuestionCount > 0 && access?.reason !== "free-quota" && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-6 py-10 text-center dark:border-blue-900 dark:bg-blue-950/30">
          {loggedIn ? (
            <>
              {/* 시간당 한도 초과: 로그인은 돼 있으니 로그인 유도 대신 "잠시 후"로만
                  완만하게 안내한다 — 정상 사용자는 이 문구 자체를 볼 일이 없다.
                  무료 한도(위 분기)와 절대 섞지 않는다: 수집 시도를 "결제하면 됩니다"로
                  안내하게 되고, 반대로 정상 사용자에게는 결제하면 풀린다는 거짓말이 된다. */}
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
                href={`/login?next=${encodeURIComponent(paperExplanationsHref(paper))}`}
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
          href={paperCbtHref(paper)}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Monitor size={15} />
          온라인에서 풀기
        </Link>
        <Link
          href={paperHref(paper)}
          className="flex flex-1 items-center justify-center rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
        >
          문제지로
        </Link>
      </div>
    </div>
  );
}
