"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

type ViewKey = "papers" | "questions";

// 과목 오답노트의 "문제지별 / 문항 모아보기" 탭. 두 뷰는 서버에서 따로 조회하는
// ?view 쿼리 내비게이션이라(무거운 문항 조립을 필요할 때만 하는 분리), 전환이
// 즉시가 아니다 — 눌린 탭에 스피너를 띄우고 이전 내용은 흐리게 두어 "넘어가는 중"
// 임을 보여준다. 반대쪽 뷰는 미리 프리페치해 전환 자체도 앞당긴다.
export function WrongNoteViewTabs({
  view,
  base,
  children,
}: {
  view: ViewKey;
  base: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [target, setTarget] = useState<ViewKey | null>(null);

  const hrefOf = (key: ViewKey) => (key === "papers" ? base : `${base}?view=questions`);

  useEffect(() => {
    router.prefetch(hrefOf(view === "papers" ? "questions" : "papers"));
    // base가 같으면 다시 걸 필요 없다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, base]);

  function go(key: ViewKey) {
    if (key === view || pending) return;
    setTarget(key);
    start(() => router.push(hrefOf(key)));
  }

  const tab = (key: ViewKey, label: string) => (
    <button
      type="button"
      onClick={() => go(key)}
      className={`flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        view === key
          ? "bg-blue-600 text-white"
          : "border border-zinc-200 text-zinc-600 hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-blue-700 dark:hover:text-blue-400"
      }`}
    >
      {label}
      {pending && target === key && <Loader2 size={13} className="animate-spin" />}
    </button>
  );

  return (
    <>
      <div className="flex gap-2">
        {tab("papers", "시험지별")}
        {tab("questions", "문제만 모아보기")}
      </div>
      <div className={pending ? "pointer-events-none opacity-50 transition-opacity" : ""}>
        {children}
      </div>
    </>
  );
}
