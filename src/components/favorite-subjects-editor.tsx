"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Star, X } from "lucide-react";
import { toggleSubjectBookmark } from "@/app/subjects/actions";
import type { Subject } from "@/lib/supabase/types";

// 마이페이지 즐겨찾기 탭의 "즐겨찾는 과목" 편집 영역. 즐겨찾은 과목을 칩으로
// 보여주고, "편집"을 누르면 전체 과목 목록 모달에서 별을 눌러 추가/제거한다.
// 상태는 낙관적으로 즉시 반영하고, 서버 액션이 실패하면 되돌린다.
export function FavoriteSubjectsEditor({
  subjects,
  initialBookmarkedIds,
}: {
  subjects: Subject[];
  initialBookmarkedIds: string[];
}) {
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(
    () => new Set(initialBookmarkedIds),
  );
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const favorites = useMemo(
    () => subjects.filter((s) => bookmarkedIds.has(s.id)),
    [subjects, bookmarkedIds],
  );
  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? subjects.filter((s) => s.name.includes(q)) : subjects;
  }, [subjects, query]);

  function toggle(subjectId: string) {
    setError(null);
    const wasBookmarked = bookmarkedIds.has(subjectId);
    setBookmarkedIds((prev) => {
      const next = new Set(prev);
      if (wasBookmarked) next.delete(subjectId);
      else next.add(subjectId);
      return next;
    });
    startTransition(async () => {
      const result = await toggleSubjectBookmark(subjectId);
      if (result.error) {
        setError(result.error);
        setBookmarkedIds((prev) => {
          const next = new Set(prev);
          if (wasBookmarked) next.add(subjectId);
          else next.delete(subjectId);
          return next;
        });
      }
    });
  }

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Star size={18} className="text-amber-400" />
          즐겨찾는 과목 ({favorites.length})
        </h2>
        <button
          type="button"
          onClick={() => setEditorOpen(true)}
          className="flex items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
        >
          <Pencil size={12} />
          편집
        </button>
      </div>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      {favorites.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          아직 즐겨찾는 과목이 없어요. 편집을 눌러 과목을 추가해보세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {favorites.map((s) => (
            <span
              key={s.id}
              className="flex items-center gap-1 rounded-full border border-zinc-200 py-1 pl-3 pr-1.5 text-sm dark:border-zinc-700"
            >
              <Link
                href={`/subjects/${s.slug}`}
                className="hover:text-blue-600 dark:hover:text-blue-400"
              >
                {s.name}
              </Link>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                aria-label={`${s.name} 즐겨찾기 해제`}
                className="flex h-5 w-5 items-center justify-center rounded-full text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
              >
                <X size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      {editorOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setEditorOpen(false)}
        >
          <div
            className="flex max-h-[70vh] w-full max-w-md flex-col rounded-xl bg-white p-5 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">즐겨찾는 과목 편집</h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="text-sm text-zinc-400 dark:text-zinc-600"
              >
                닫기
              </button>
            </div>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="과목 이름 검색"
              className="mb-3 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-blue-400 dark:border-zinc-700 dark:bg-zinc-900"
            />
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <p className="py-6 text-center text-sm text-zinc-500 dark:text-zinc-500">
                  해당하는 과목이 없어요.
                </p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((s) => {
                    const bookmarked = bookmarkedIds.has(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-pressed={bookmarked}
                        className={`flex items-center justify-between gap-1.5 rounded-lg border px-3 py-2 text-sm ${
                          bookmarked
                            ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
                            : "border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
                        }`}
                      >
                        <span className="truncate">{s.name}</span>
                        <Star
                          size={14}
                          className="shrink-0"
                          fill={bookmarked ? "currentColor" : "none"}
                        />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
