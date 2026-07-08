import Link from "next/link";
import type { CSSProperties } from "react";
import { ChevronRight, MapPin, Monitor } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor } from "@/lib/level-colors";
import { getRoundTier } from "@/lib/round-tier";
import { BookmarkButton } from "@/components/bookmark-button";
import type { ExamPaper } from "@/lib/supabase/types";

export function ExamCard({
  paper,
  isCurrent = false,
  linkLevel,
  myRoundCount,
  isBookmarked = false,
  loggedIn = false,
  hasCbtAnswers = false,
}: {
  paper: ExamPaper;
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
  const subject = paper.subjects;
  const roundTier = myRoundCount ? getRoundTier(myRoundCount) : null;
  const href = linkLevel
    ? `/papers/${paper.id}?level=${encodeURIComponent(linkLevel)}`
    : `/papers/${paper.id}`;

  const className = `relative flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
    isCurrent
      ? "border-2 border-blue-500 bg-blue-50/50"
      : "border-zinc-200 hover:border-blue-300 hover:shadow-sm"
  }`;

  return (
    <div className={className}>
      {/* 카드 전체를 상세페이지로 이어주는 보이지 않는 링크. 배지/제목처럼 위치를
          지정하지 않은(static) 텍스트 위로는 그대로 깔리지만, 북마크 버튼·바로
          풀기 링크처럼 z-10을 준 요소는 그 위에서 각자 따로 클릭된다. */}
      {!isCurrent && (
        <Link
          href={href}
          aria-label={paper.title}
          className="absolute inset-0 z-0 rounded-xl"
        />
      )}

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {paper.level && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-bold ${levelColor(paper.level)}`}
            >
              {paper.level}
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

        <div className="flex shrink-0 items-center gap-1.5">
          {isCurrent ? (
            <span className="flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
              <MapPin size={12} />
              현재 보는 중
            </span>
          ) : (
            <>
              {/* 배지/필처럼 클릭 동작이 없는 형제와 달리, 이 버튼은 카드 전체
                  링크보다 위에서 따로 클릭돼야 해서 z-10을 준다. */}
              <span className="relative z-10">
                <BookmarkButton
                  paperId={paper.id}
                  initialBookmarked={isBookmarked}
                  loggedIn={loggedIn}
                  size="sm"
                />
              </span>
              {roundTier && (
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
            </>
          )}
        </div>
      </div>

      <p className="font-medium leading-snug">{paper.title}</p>

      {!isCurrent && (
        <div className="mt-auto flex items-center justify-end border-t border-zinc-100 pt-3 text-xs">
          {hasCbtAnswers ? (
            // 카드 전체 링크(상세페이지)와 다른 목적지로 가야 해서 z-10으로 그
            // 위에서 따로 클릭되게 한다. "자세히 보기"는 목적지가 같으므로
            // 그대로 아래 카드 전체 링크에 맡긴다.
            <Link
              href={`/papers/${paper.id}/cbt`}
              className="relative z-10 flex items-center gap-1 font-medium text-blue-600 hover:underline"
            >
              <Monitor size={14} />
              바로 풀기
            </Link>
          ) : (
            <span className="flex items-center gap-1 font-medium text-blue-600">
              자세히 보기
              <ChevronRight size={14} />
            </span>
          )}
        </div>
      )}
    </div>
  );
}
