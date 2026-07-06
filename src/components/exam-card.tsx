import Link from "next/link";
import { ChevronRight, MapPin } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { levelColor } from "@/lib/level-colors";
import { roundBadgeColor } from "@/lib/round-colors";
import { formatCount, formatFileSize } from "@/lib/format";
import type { ExamPaper } from "@/lib/supabase/types";

export function ExamCard({
  paper,
  isCurrent = false,
  linkLevel,
  myRoundCount,
}: {
  paper: ExamPaper;
  isCurrent?: boolean;
  // 상세페이지 하단 "같은 과목 목록"의 급수 탭 상태를 이어서 넘겨주기 위한 값
  linkLevel?: string;
  // 로그인한 사용자가 이 문제지를 CBT로 몇 번 풀었는지 (없으면 배지 자체를 안 보여줌)
  myRoundCount?: number;
}) {
  const subject = paper.subjects;
  const examType = paper.exam_types;
  const fileSize = formatFileSize(paper.file_size);

  const className = `flex flex-col gap-3 rounded-xl border p-4 transition-colors ${
    isCurrent
      ? "border-2 border-blue-500 bg-blue-50/50"
      : "border-zinc-200 hover:border-blue-300 hover:shadow-sm"
  }`;

  const content = (
    <>
      <div className="flex items-start justify-between">
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
        {isCurrent ? (
          <span className="flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            <MapPin size={12} />
            현재 보는 중
          </span>
        ) : (
          !!myRoundCount && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${roundBadgeColor(myRoundCount)}`}
            >
              {myRoundCount}회독
            </span>
          )
        )}
      </div>

      <p className="font-medium leading-snug">{paper.title}</p>

      <p className="text-xs text-zinc-500">
        {examType?.name}
        {examType?.name ? " · " : ""}
        {paper.year}년
        {paper.round > 1 ? ` · ${paper.round}회차` : ""}
        {paper.question_count ? ` · ${paper.question_count}문제` : ""}
        {paper.tags.length > 0 &&
          paper.tags.map((tag) => ` #${tag}`).join("")}
      </p>

      <div className="mt-auto flex items-center justify-between border-t border-zinc-100 pt-3 text-xs text-zinc-500">
        <span>
          다운로드 {formatCount(paper.download_count)}회
          {fileSize ? ` · ${fileSize}` : ""}
        </span>
        {!isCurrent && (
          <span className="flex items-center gap-1 font-medium text-blue-600">
            자세히 보기
            <ChevronRight size={14} />
          </span>
        )}
      </div>
    </>
  );

  if (isCurrent) {
    return <div className={className}>{content}</div>;
  }

  const href = linkLevel
    ? `/papers/${paper.id}?level=${encodeURIComponent(linkLevel)}`
    : `/papers/${paper.id}`;

  return (
    <Link href={href} className={className}>
      {content}
    </Link>
  );
}
