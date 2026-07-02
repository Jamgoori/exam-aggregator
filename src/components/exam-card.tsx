import Link from "next/link";
import { FileText, ChevronRight, MapPin } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { formatCount, formatFileSize, isRecent } from "@/lib/format";
import type { ExamPaper } from "@/lib/supabase/types";

export function ExamCard({
  paper,
  isCurrent = false,
}: {
  paper: ExamPaper;
  isCurrent?: boolean;
}) {
  const subject = paper.subjects;
  const examType = paper.exam_types;
  const isNew = isRecent(paper.created_at, 14);
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
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
            <FileText size={16} />
          </span>
          {subject && (
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${subjectColor(subject.slug)}`}
            >
              {subject.name}
            </span>
          )}
          {paper.level && (
            <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {paper.level}
            </span>
          )}
        </div>
        {isCurrent ? (
          <span className="flex items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5 text-xs font-semibold text-white">
            <MapPin size={12} />
            현재 보는 중
          </span>
        ) : (
          isNew && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
              NEW
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

  return (
    <Link href={`/papers/${paper.id}`} className={className}>
      {content}
    </Link>
  );
}
