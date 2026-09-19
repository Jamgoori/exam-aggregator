"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ellipsis, Flag, Heart, Link2, Trash2, UserX } from "lucide-react";
import { blockUser, deleteBoardPost, toggleBoardLike } from "@/app/board/actions";
import { BoardReportDialog } from "@/components/board-report-dialog";

// 글 하단의 좋아요·공유 줄. 좋아요는 누른 즉시 숫자가 바뀌고(낙관적 반영),
// 서버가 거절하면 되돌린다 — 왕복을 기다리게 하면 "눌렸나?" 하고 두 번 누른다.
export function BoardLikeButton({
  postId,
  initialLiked,
  initialCount,
  loggedIn,
}: {
  postId: string;
  initialLiked: boolean;
  initialCount: number;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function toggle() {
    if (!loggedIn) {
      setError("로그인 후 이용할 수 있어요.");
      return;
    }
    setError(null);
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => Math.max(0, c + (nextLiked ? 1 : -1)));

    startTransition(async () => {
      const result = await toggleBoardLike(postId);
      if (result.error) {
        setLiked(!nextLiked);
        setCount((c) => Math.max(0, c + (nextLiked ? -1 : 1)));
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={toggle}
        aria-pressed={liked}
        className={`flex items-center gap-1.5 rounded-full border px-5 py-2.5 text-sm font-bold transition-colors ${
          liked
            ? "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-400"
            : "border-zinc-200 text-zinc-500 hover:border-rose-200 hover:text-rose-500 dark:border-zinc-700 dark:text-zinc-400 dark:hover:border-rose-900"
        }`}
      >
        <Heart size={16} fill={liked ? "currentColor" : "none"} />
        좋아요 {count}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

export function BoardShareButton() {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(window.location.href);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          // 클립보드 권한이 없는 브라우저(구형 인앱 브라우저 등)에서는 조용히 넘긴다 —
          // 주소창이 이미 같은 주소를 들고 있어서 사용자가 직접 복사할 수 있다.
        }
      }}
      className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
    >
      <Link2 size={13} />
      {copied ? "주소 복사됨" : "공유"}
    </button>
  );
}

export function BoardDeleteButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("이 글을 삭제할까요? 되돌릴 수 없어요.")) return;
          startTransition(async () => {
            const result = await deleteBoardPost(postId);
            if (result.error) {
              setError(result.error);
              return;
            }
            router.push("/board");
            router.refresh();
          });
        }}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-red-300 hover:text-red-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-900 dark:hover:text-red-400"
      >
        <Trash2 size={13} />
        {pending ? "삭제 중…" : "삭제"}
      </button>
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </>
  );
}

// 글 머리의 더보기(⋯) — 앱 board-post-actions.tsx 의 BoardMoreMenu 를 웹으로 옮긴 것(앱→웹 1:1,
// 설계서 §12-2 #16 — 스토어 UGC 요건이 먼저 앱에 들어왔고 웹이 따라간다). 본인 글에는 그리지
// 않는다(호출부가 판단). 항목 순서·문구는 앱과 같다: "신고" → "이 사용자 차단". 신고는
// board-report-dialog.tsx, 차단은 window.confirm(앱 Alert 제목+본문과 같은 문장) 한 번 뒤 서버
// 액션 blockUser → router.refresh() — 상세가 차단 안내 블록으로 바뀌는 것이 곧 확인 문구다.
// 비로그인은 신고·차단 모두 로그인이 필요하므로 좋아요와 같은 문구를 그 자리에 보여준다.
//
// role="menu" 는 쓰지 않는다(user-menu.tsx 와 같은 이유 — 항목 두 개짜리 패널이라 Tab 이동이
// 자연스럽다). 바깥 pointerdown·Esc 로 닫는 규칙도 그쪽과 같다.
export const BLOCK_CONFIRM_MESSAGE =
  "이 사용자를 차단할까요?\n차단한 사용자의 글과 댓글이 보이지 않아요. 내 정보 수정에서 해제할 수 있어요.";

export function BoardMoreMenu({
  postId,
  authorId,
  loggedIn,
}: {
  postId: string;
  authorId: string;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function confirmBlock() {
    setOpen(false);
    if (!window.confirm(BLOCK_CONFIRM_MESSAGE)) return;
    setError(null);
    startTransition(async () => {
      const result = await blockUser(authorId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        disabled={pending}
        aria-label="더보기"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          if (!loggedIn) {
            setError("로그인 후 이용할 수 있어요.");
            return;
          }
          setError(null);
          setOpen((v) => !v);
        }}
        className="flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-blue-800 dark:hover:text-blue-400"
      >
        <Ellipsis size={13} />
      </button>

      {open && (
        <div
          id={panelId}
          className="animate-modal-panel-in absolute top-full right-0 z-40 mt-2 flex w-44 origin-top-right flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white p-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40"
        >
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setReportOpen(true);
            }}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-zinc-800 transition-colors hover:bg-zinc-100 dark:text-zinc-100 dark:hover:bg-zinc-800"
          >
            <Flag size={16} className="text-zinc-600 dark:text-zinc-300" />
            신고
          </button>
          <button
            type="button"
            onClick={confirmBlock}
            className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-red-600 transition-colors hover:bg-zinc-100 dark:text-red-400 dark:hover:bg-zinc-800"
          >
            <UserX size={16} />
            이 사용자 차단
          </button>
        </div>
      )}

      {error && (
        <p className="absolute top-full right-0 mt-1 w-max text-xs text-red-600 dark:text-red-400">{error}</p>
      )}

      {reportOpen && (
        <BoardReportDialog target="board_post" targetId={postId} onClose={() => setReportOpen(false)} />
      )}
    </div>
  );
}
