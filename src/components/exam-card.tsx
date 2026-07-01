import Link from "next/link";
import { FileText, ChevronRight } from "lucide-react";
import { subjectColor } from "@/lib/subject-colors";
import { formatCount, formatFileSize, isRecent } from "@/lib/format";
import type { ExamPaper } from "@/lib/supabase/types";

export function ExamCard({ paper }: { paper: ExamPaper }) {
  const subject = paper.subjects;
  const examType = paper.exam_types;
  const isNew = isRecent(paper.created_at, 14);
  const fileSize = formatFileSize(paper.file_size);

  return (
    <Link
      href={`/papers/${paper.id}`}
      className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 hover:border-zinc-400"
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500">
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
        {isNew && (
          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-semibold text-white">
            NEW
          </span>
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
        <span className="flex items-center gap-1 font-medium text-zinc-900">
          자세히 보기
          <ChevronRight size={14} />
        </span>
      </div>
    </Link>
  );
}
