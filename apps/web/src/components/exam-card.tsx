import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronRight, MapPin, Monitor } from "lucide-react";
import { levelColor } from "@/lib/level-colors";
import { examTypeFilledColor } from "@/lib/exam-type-colors";
import { getRoundTier } from "@/lib/round-tier";
import { BookmarkButton } from "@/components/bookmark-button";
import { getPaperDisplayTitle } from "@/lib/paper-title";
import { paperHref, paperCbtHref } from "@/lib/paper-href";
import type { ExamPaper, ExamType } from "@gongmoa/core";

// 카드가 실제로 읽는 필드만 요구한다 — 목록 화면마다 조회 범위가 달라서(시험별
// 목록은 파일 경로·조회수 같은 걸 받아오지 않는다), 전체 ExamPaper를 요구하면
// 쓰지도 않을 필드를 가짜로 채워 넘기게 된다. ExamPaper는 이 타입의 상위집합이라
// 기존 호출부는 그대로 통과한다.
// round는 화면에 쓰지 않지만 주소를 만드는 데 필요하다 (paper-href.ts).
export type ExamCardPaper = Pick<
  ExamPaper,
  "id" | "title" | "track" | "level" | "round"
> & {
  exam_types?: ExamType | null;
};

export function ExamCard({
  paper,
  isCurrent = false,
  linkLevel,
  myRoundCount,
  isBookmarked = false,
  loggedIn = false,
  hasCbtAnswers = false,
}: {
  paper: ExamCardPaper;
  isCurrent?: boolean;
  // 상세페이지 하단 "같은 과목 목록"의 급수 탭 상태를 이어서 넘겨주기 위한 값
  linkLevel?: string;
  // 로그인한 사용자가 이 문제지를 CBT로 몇 번 풀었는지 (없으면 배지 자체를 안 보여줌)
  myRoundCount?: number;
  // 로그인한 사용자가 이 문제지를 즐겨찾기했는지
  isBookmarked?: boolean;
  loggedIn?: boolean;
  // CBT 정답이 등록돼 있어 "바로 풀기"로 온라인 응시로 바로 넘어갈 수 있는지
  hasCbtAnswers?: boolean;
}) {
  const examType = paper.exam_types;
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);
  const roundTier = myRoundCount ? getRoundTier(myRoundCount) : null;
  const detailHref = paperHref(paper);
  const href = linkLevel
    ? `${detailHref}?level=${encodeURIComponent(linkLevel)}`
    : detailHref;

  const className = `relative flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
    isCurrent
      ? "border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
      : "border-zinc-200 hover:border-blue-300 hover:shadow-sm dark:border-zinc-700 dark:hover:border-blue-700"
  }`;

  return (
    <div className={className}>
      {/* 카드 전체를 상세페이지로 이어주는 보이지 않는 링크. 배지/제목처럼 위치를
          지정하지 않은(static) 텍스트 위로는 그대로 깔리지만, 북마크 버튼·바로
          풀기 링크처럼 z-10을 준 요소는 그 위에서 각자 따로 클릭된다. */}
      {!isCurrent && (
        <Link
          href={href}
          aria-label={displayTitle}
          className="absolute inset-0 z-0 rounded-xl"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {paper.level && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}
            >
              {paper.level}
            </span>
          )}
          {examType && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${examTypeFilledColor(examType.name)}`}
            >
              {examType.name}
            </span>
          )}
          {!isCurrent && roundTier && (
            <span
              title={`${roundTier.name} (${myRoundCount}회독)`}
              className={`tier-badge shrink-0 rounded-full px-2 py-0.5 text-xs font-bold ${roundTier.hasFlash ? "tier-flash" : ""} ${roundTier.hasGlow ? "tier-glow" : ""} ${roundTier.className}`}
              style={
                {
                  "--shimmer-opacity": roundTier.shimmerOpacity,
                  "--badge-duration": roundTier.duration,
                } as CSSProperties
              }
            >
              {myRoundCount}회독
            </span>
          )}
        </div>

        {isCurrent ? (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            <MapPin size={12} />
            현재 보는 중
          </span>
        ) : (
          // 배지처럼 클릭 동작이 없는 형제와 달리, 이 버튼은 카드 전체 링크보다
          // 위에서 따로 클릭돼야 해서 z-10을 준다.
          <span className="relative z-10 shrink-0">
            <BookmarkButton
              paperId={paper.id}
              initialBookmarked={isBookmarked}
              loggedIn={loggedIn}
              size="sm"
            />
          </span>
        )}
      </div>

      <p className="font-medium leading-snug">{displayTitle}</p>

      {!isCurrent && (
        <div className="mt-auto flex items-center border-t border-zinc-100 pt-3 text-xs dark:border-zinc-700">
          {hasCbtAnswers && (
            // 카드 전체 링크(상세페이지)와 다른 목적지로 가야 해서 z-10으로 그
            // 위에서 따로 클릭되게 한다. "자세히 보기"는 목적지가 같으므로
            // 그대로 아래 카드 전체 링크에 맡긴다.
            <Link
              href={paperCbtHref(paper)}
              className="relative z-10 flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 font-medium text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-400 dark:hover:bg-blue-900/40"
            >
              <Monitor size={12} />
              바로 풀기
            </Link>
          )}
          <span className="ml-auto flex items-center gap-1 font-medium text-blue-600 dark:text-blue-400">
            자세히 보기
            <ChevronRight size={14} />
          </span>
        </div>
      )}
    </div>
  );
}
