import Link from "next/link";
import { ChevronRight } from "lucide-react";

// 홈 검색창 바로 아래에 놓는 오답노트 바로가기 배너. 마이페이지의 "남은 오답"
// 값(getMyUnresolvedTotal)을 받아 복습이 밀려 있음을 한 줄로 알려주고, 누르면
// 오답노트 탭으로 바로 이동한다. 남은 오답이 없을 땐 페이지에서 렌더하지 않는다.
export function WrongNoteShortcut({ count }: { count: number }) {
  return (
    <Link
      href="/mypage?tab=wrong-notes#wrong-notes"
      aria-label={`복습을 기다리는 오답 ${count}문항, 오답노트로 이동`}
      className="group flex w-full items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3.5 transition-colors hover:bg-blue-100/70 sm:px-5 sm:py-4 dark:border-blue-900/50 dark:bg-blue-950/25 dark:hover:bg-blue-950/40"
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-blue-900 sm:text-base dark:text-blue-100">
          현재 복습을 기다리는 오답이{" "}
          <span className="text-blue-600 dark:text-blue-300">{count}문항</span>{" "}
          있어요!
        </p>
        <p className="text-xs text-blue-700/70 dark:text-blue-300/60">
          오답노트에서 틀린 문제를 모아 다시 풀어보세요
        </p>
      </div>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/70 text-blue-500 transition-transform group-hover:translate-x-0.5 dark:bg-blue-900/40 dark:text-blue-300">
        <ChevronRight size={18} />
      </span>
    </Link>
  );
}
