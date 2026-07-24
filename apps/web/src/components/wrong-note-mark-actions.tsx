"use client";

import { useEffect, useRef, useTransition } from "react";
import { BookmarkCheck, RotateCcw, Trash2 } from "lucide-react";
import {
  deleteWrongNoteQuestion,
  restoreWrongNoteQuestion,
  setQuestionPinned,
} from "@/app/mypage/wrong-notes/actions";

// 오답노트 문항 카드의 우측 액션: "다시 볼 문제" 체크 토글 + 완전 삭제.
// 상태(핀/삭제 목록)는 부모(목록 컴포넌트)가 들고 있어 토글·삭제가 필터에 즉시
// 반영되고, 서버 반영이 실패하면 되돌린다.
export function WrongNoteMarkActions({
  paperId,
  questionNumber,
  pinned,
  onPinnedChange,
  onDeleted,
}: {
  paperId: string;
  questionNumber: number;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  onDeleted: () => void;
}) {
  const [, start] = useTransition();

  function togglePin() {
    const next = !pinned;
    onPinnedChange(next);
    start(async () => {
      const res = await setQuestionPinned({ paperId, questionNumber, pinned: next });
      if (res.error) {
        onPinnedChange(!next);
        window.alert(res.error);
      }
    });
  }

  function remove() {
    if (
      !window.confirm(
        "이 문항을 오답노트에서 완전히 삭제할까요?\n오답 목록·통계·다시 풀기에서 더 이상 보이지 않아요. (삭제 직후 '되돌리기'로 복구할 수 있어요)",
      )
    ) {
      return;
    }
    start(async () => {
      const res = await deleteWrongNoteQuestion({ paperId, questionNumber });
      if (res.error) {
        window.alert(res.error);
        return;
      }
      onDeleted();
    });
  }

  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={togglePin}
        aria-pressed={pinned}
        title={pinned ? "다시 볼 문제에서 해제" : "다시 볼 문제로 체크"}
        className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors ${
          pinned
            ? "border-amber-300 bg-amber-50 text-amber-600 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-400"
            : "border-zinc-200 text-zinc-400 hover:border-amber-300 hover:text-amber-500 dark:border-zinc-700 dark:text-zinc-500 dark:hover:border-amber-700 dark:hover:text-amber-400"
        }`}
      >
        <BookmarkCheck size={13} />
        다시보기
      </button>
      <button
        type="button"
        onClick={remove}
        aria-label="오답노트에서 삭제"
        title="오답노트에서 완전 삭제"
        className="flex h-6 w-6 items-center justify-center rounded-full text-zinc-300 hover:bg-red-50 hover:text-red-500 dark:text-zinc-600 dark:hover:bg-red-950/30 dark:hover:text-red-400"
      >
        <Trash2 size={13} />
      </button>
    </span>
  );
}

// 삭제 직후 잠깐 뜨는 "되돌리기" 토스트. 오클릭으로 오답 기록을 잃지 않게 하는
// 안전장치로, 8초 뒤(또는 다른 문항을 삭제하면 교체되어) 사라진다. 부모가
// key로 문항마다 새로 마운트해 타이머가 삭제 건별로 다시 시작된다.
export function WrongNoteUndoToast({
  paperId,
  questionNumber,
  onRestored,
  onDismiss,
  bottomClass = "bottom-4",
}: {
  paperId: string;
  questionNumber: number;
  onRestored: () => void;
  onDismiss: () => void;
  // 하단에 선택 액션 바가 떠 있는 화면에서는 그 위로 올린다.
  bottomClass?: string;
}) {
  const [pending, start] = useTransition();
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    const t = setTimeout(() => dismissRef.current(), 8000);
    return () => clearTimeout(t);
  }, []);

  function undo() {
    if (pending) return;
    start(async () => {
      const res = await restoreWrongNoteQuestion({ paperId, questionNumber });
      if (res.error) {
        window.alert(res.error);
        return;
      }
      onRestored();
    });
  }

  return (
    <div className={`fixed inset-x-0 z-40 flex justify-center px-4 ${bottomClass}`}>
      <div className="flex items-center gap-3 rounded-full border border-zinc-200 bg-white py-2 pl-4 pr-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <span className="text-zinc-600 dark:text-zinc-400">
          {questionNumber}번 문항을 오답노트에서 삭제했어요
        </span>
        <button
          type="button"
          onClick={undo}
          disabled={pending}
          className="flex shrink-0 items-center gap-1 rounded-full bg-zinc-100 px-3 py-1 text-xs font-bold text-zinc-700 hover:bg-zinc-200 disabled:opacity-60 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
        >
          <RotateCcw size={12} />
          {pending ? "되돌리는 중..." : "되돌리기"}
        </button>
      </div>
    </div>
  );
}
