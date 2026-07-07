"use client";

import { useState } from "react";
import Link from "next/link";
import { CONSONANTS, initialConsonant } from "@/lib/hangul";
import type { Subject } from "@/lib/supabase/types";

export function SubjectIndexTabs({ subjects }: { subjects: Subject[] }) {
  const [active, setActive] = useState<string | null>(null);

  const filtered = active
    ? subjects.filter((s) => initialConsonant(s.name) === active)
    : [];

  return (
    <>
      <div className="flex flex-wrap gap-3 border-t border-zinc-100 pt-3">
        {CONSONANTS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setActive(c)}
            className="flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-sm font-medium text-zinc-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
          >
            {c}
          </button>
        ))}
      </div>

      {active && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setActive(null)}
        >
          <div
            className="max-h-[70vh] w-full max-w-md overflow-y-auto rounded-xl bg-white p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">&apos;{active}&apos; 과목</h3>
              <button
                type="button"
                onClick={() => setActive(null)}
                className="text-sm text-zinc-400"
              >
                닫기
              </button>
            </div>
            {filtered.length === 0 ? (
              <p className="py-6 text-center text-sm text-zinc-500">
                해당하는 과목이 없어요.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {filtered.map((s) => (
                  <Link
                    key={s.id}
                    href={`/subjects/${s.slug}`}
                    onClick={() => setActive(null)}
                    className="rounded-lg border border-zinc-200 px-3 py-2 text-center text-sm hover:border-blue-300 hover:bg-blue-50 hover:text-blue-600"
                  >
                    {s.name}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
