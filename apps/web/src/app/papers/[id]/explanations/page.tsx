import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Hourglass, Monitor } from "lucide-react";
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
    // 이 페이지는 로그인 없이는 아예 렌더링되지 않고 /login 으로 리다이렉트된다
    // (아래 PaperExplanationsPage) — 크롤러도 로그인 화면만 보게 되므로 색인해도
    // 얻을 콘텐츠가 없다. follow는 남겨서 이 페이지의 링크(문제지 상세)는 계속
    // 따라가게 한다.
    robots: { index: false, follow: true },
  };
}

// 로그인은 돼 있지만 시간당 한도를 넘긴 요청에게만 렌더링해주는 해설 카드 수.
// 나머지 문항은 CSS로 가리는 게 아니라 서버가 HTML에 아예 담지 않는다.
const LIMITED_ACCESS_PREVIEW_CARDS = 2;

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

  // "해설 열기"(view)·"해설 다운로드"(download=1) 둘 다 로그인이 있어야 한다 — 문제
  // PDF(/download/[id])·정답 PDF(/download/answer/[id])와 같은 기준. 비로그인은 여기서
  // 막고 로그인 뒤 같은 주소(download=1까지 포함)로 돌아오게 한다.
  if (!user) {
    const base = paperExplanationsHref(paper);
    const next = isDownload ? `${base}?download=1` : base;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // 여기부터는 항상 로그인 상태다. 시간당 한도 판정만 남는다 — "해설 열기"/"다운로드"
  // 아이콘이 각각 view/download로 들어오므로, 같은 사람이라도 시간당 한도는 독립적으로
  // 소진된다. 무료 회원의 하루 몫은 반대로 둘을 합쳐 문제지 단위로 센다 — "이 문제지
  // 해설을 오늘 봤는가"가 기준이라, 같은 문제지를 열람했다가 내려받는 건 한 개다.
  const access = await resolveExplanationAccess({
    userId: user.id,
    paperId: paper.id,
    action: isDownload ? "download" : "view",
    premium: await isPremium(supabase, user.id),
  });
  const hasFullAccess = access.full;

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

  // 시간당 한도를 넘긴 요청은 미리보기 카드까지만 서버가 렌더링한다
  // (나머지는 응답에 포함 안 됨 — CSS로 가리는 게 아니다).
  const visibleGroups = hasFullAccess ? groups : groups.slice(0, LIMITED_ACCESS_PREVIEW_CARDS);
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
              {getSubjectDisplayName(subject.name, examType?.name, paper.level)}
            </span>
          )}
        </div>

        {/* 인쇄 시 대제목은 화면(24px=18pt)보다 4pt 작게. */}
        <h1 className="text-2xl font-semibold leading-snug print:text-[14pt]">
          {displayTitle} 해설
        </h1>

        {/* 인쇄물 첫 줄 저작권 고지. 인쇄본에 이용 조건을 남기는 건 이 한 줄이다
            (약관 제4조). */}
        <p className="hidden text-[8pt] text-zinc-500 print:block">
          공모아(gongmoa) 제작 해설 · 개인 학습용으로만 이용할 수 있으며 무단 전재·
          재배포·2차 이용을 금합니다. 문제 이미지는 원본 문제지 PDF에서 확인하세요.
        </p>

        {/* "N문항 해설" 줄 — 버튼·범례 포함 전부 화면 전용이라 인쇄에서 통째로 숨긴다. */}
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-500 print:hidden dark:text-zinc-500">
          <span>{questions.length}문항 해설</span>
          <span className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-500">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            정답
          </span>
          {hasFullAccess && (
            <span className="ml-auto flex items-center gap-2">
              <span className="text-xs text-zinc-400 dark:text-zinc-600">
                인쇄본에는 해설만 담겨요
              </span>
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

      {/* 인쇄(PDF 저장): 카드를 좌우 2단으로 흘려 채운다(CSS 멀티컬럼).
          grid-cols-2로 채우던 때는 카드 하나가 격자 칸 하나를 통째로 차지해서,
          짧은 해설 옆에 긴 해설이 놓이면 짧은 쪽 아래가 페이지 절반씩 비었다.
          인쇄본은 이미지를 빼고 텍스트만 남기므로(hideImagesInPrint) 카드를
          통으로 유지할 이유가 없다 — 단 경계에서 잘려 다음 단으로 이어져도 그냥
          읽힌다. 그래서 카드를 칸에 넣는 대신 본문처럼 흘린다.

          - print:block: 화면의 flex 컨테이너에는 column-count가 먹지 않는다.
            예전에 "오른쪽 단이 통째로 빈다"(#96~#99)고 본 것이 이것이다.
          - column-fill은 기본값(balance) 그대로 둔다. column-fill:auto를 주면
            내용은 같은데 뒤에 빈 페이지가 여러 장 붙는다(크롬 141 실측: 5쪽 →
            9쪽, 6~9쪽이 백지). balance로도 마지막 장을 뺀 모든 페이지는 양 단이
            끝까지 차고, 마지막 장만 두 단에 고르게 나뉜다.
          - 단 간격은 print:gap-x-6(column-gap), 카드 사이 세로 간격은 카드의
            print:mb-3가 준다.

          읽는 순서는 왼쪽 단을 끝까지 내려간 뒤 오른쪽 단으로 넘어가는 신문식이
          된다(격자였을 때의 좌→우 가로 우선에서 바뀐 부분). */}
      <div className="flex flex-col gap-4 print:block print:columns-2 print:gap-x-6">
        {visibleGroups.map((group) => (
          <WrongNoteQuestionCard
            key={group.rows[0].questionNumber}
            rows={group.rows}
            images={group.images}
            explanationsOpen
            showSelection={false}
            hideImagesInPrint
            paperId={hasFullAccess ? paper.id : undefined}
            reportContext="explanation"
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
          {/* 시간당 한도 초과: 여기 도달하려면 이미 로그인이 돼 있으므로 로그인 유도 대신
              "잠시 후"로만 완만하게 안내한다 — 정상 사용자는 이 문구 자체를 볼 일이 없다.
              무료 한도(위 분기)와 절대 섞지 않는다: 수집 시도를 "결제하면 됩니다"로
              안내하게 되고, 반대로 정상 사용자에게는 결제하면 풀린다는 거짓말이 된다. */}
          <Hourglass size={28} className="text-blue-600 dark:text-blue-400" />
          <p className="font-semibold">잠시 후 다시 시도해주세요</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            요청이 많아 전체 해설 표시가 일시적으로 제한됐어요.
          </p>
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
