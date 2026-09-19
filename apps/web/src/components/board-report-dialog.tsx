"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Flag, X } from "lucide-react";
import {
  REPORT_DETAIL_MAX,
  REPORT_REASONS,
  reportTargetLabel,
  validateReportInput,
  type ReportReasonSlug,
  type ReportTargetType,
} from "@gongmoa/core";
import { reportBoardPost, reportChatMessage } from "@/app/board/actions";

// UGC 신고 다이얼로그 — 앱 board-report-sheet.tsx 를 웹으로 옮긴 것(앱→웹 1:1, 설계서 §12-2 #16).
// 문구·사유 순서·버튼 이름은 앱과 같은 문장이어야 한다(두 화면이 같은 말을 해야 운영자 안내가
// 하나로 끝난다). 모달 규격은 review-guide-modal.tsx(§6.7 #7 — max-h 88vh · max-w-md · 헤더
// 그라데이션 + 아이콘 타일). 사유 목록은 core REPORT_REASONS(DB check 와 같은 값), 검증은 core
// validateReportInput — 서버 액션과 RPC report_content 본문이 같은 검사를 되풀이한다.
// "기타"만 상세 설명이 필수다(운영자가 무엇을 봐야 할지 알 수 있어야 한다). 다른 사유는
// 입력란을 그리지 않는다(앱과 같다 — 선택 입력을 두면 비운 채 보내는 사람이 대부분이다).
//
// 대상은 게시글·채팅 메시지 둘이다(target). 제목은 core reportTargetLabel 로 조립하므로
// "게시글 신고"(앱 시트 제목과 동일)·"채팅 메시지 신고" 가 된다.
export const REPORT_DONE_MESSAGE = "신고를 접수했어요. 확인 후 조치할게요.";

export function BoardReportDialog({
  target,
  targetId,
  onClose,
}: {
  target: Extract<ReportTargetType, "board_post" | "chat_message">;
  targetId: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<ReportReasonSlug | "">("");
  const [detail, setDetail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  const title = `${reportTargetLabel(target)} 신고`;

  // 열려 있는 동안 뒤 화면 스크롤을 막고 Esc 로 닫는다(사이트 모달 공통 규칙).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  function submit() {
    // 앱 useReportPost 와 같은 순서: 클라이언트 검증 → RPC(서버 액션이 같은 검증을 되풀이한다).
    const validated = validateReportInput({ reason, detail });
    if ("error" in validated) {
      setError(validated.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result =
        target === "board_post"
          ? await reportBoardPost({ postId: targetId, reason: validated.reason, detail: validated.detail })
          : await reportChatMessage({ messageId: targetId, reason: validated.reason, detail: validated.detail });
      if (result.error) {
        setError(result.error);
        return;
      }
      setDone(true);
    });
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => {
        // 채팅 패널 안에서 열리면 포털이라도 React 이벤트는 패널 백드롭까지 올라간다 — 여기서
        // 끊지 않으면 다이얼로그 바깥을 눌렀을 때 채팅창까지 함께 닫힌다.
        e.stopPropagation();
        onClose();
      }}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel-in flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-3xl dark:bg-zinc-900 dark:ring-white/10"
      >
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-center gap-3 border-b border-zinc-100 bg-gradient-to-b from-blue-50/80 to-transparent px-5 pt-4 pb-4 dark:border-zinc-800 dark:from-blue-950/30">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-blue-600 text-white shadow-sm shadow-blue-500/25">
            <Flag size={17} />
          </span>
          <h3 className="min-w-0 flex-1 text-[15px] font-bold tracking-tight">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/70 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4 break-keep">
          {done ? (
            <>
              <p role="alert" className="text-sm text-pretty text-zinc-700 dark:text-zinc-200">
                {REPORT_DONE_MESSAGE}
              </p>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
                >
                  닫기
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-pretty text-zinc-500 dark:text-zinc-400">
                신고 사유를 선택해주세요. 신고 내용은 운영자만 봅니다.
              </p>

              <div
                role="radiogroup"
                aria-label="신고 사유"
                className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700"
              >
                {REPORT_REASONS.map((r, i) => {
                  const selected = reason === r.slug;
                  return (
                    <label
                      key={r.slug}
                      className={`flex cursor-pointer items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-800/40 ${
                        i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""
                      } ${selected ? "font-semibold" : ""} text-zinc-700 dark:text-zinc-200`}
                    >
                      <input
                        type="radio"
                        name="report-reason"
                        value={r.slug}
                        checked={selected}
                        onChange={() => {
                          setReason(r.slug);
                          if (error) setError(null);
                        }}
                        className="h-[18px] w-[18px] accent-blue-600"
                      />
                      {r.label}
                    </label>
                  );
                })}
              </div>

              {reason === "other" && (
                <div className="flex flex-col gap-1.5">
                  <textarea
                    value={detail}
                    onChange={(e) => {
                      setDetail(e.target.value);
                      if (error) setError(null);
                    }}
                    maxLength={REPORT_DETAIL_MAX}
                    placeholder="어떤 점이 문제인지 적어주세요"
                    rows={3}
                    autoFocus
                    aria-label="신고 상세 설명"
                    className="min-h-20 w-full resize-y rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 dark:border-zinc-700 dark:bg-zinc-900"
                  />
                  <span className="self-end text-[11px] tabular-nums text-zinc-400 dark:text-zinc-500">
                    {detail.length} / {REPORT_DETAIL_MAX}
                  </span>
                </div>
              )}

              {error && (
                <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={pending}
                  className="rounded-lg border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50"
                >
                  취소
                </button>
                <button
                  type="button"
                  onClick={submit}
                  disabled={pending || !reason}
                  className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {pending ? "접수 중…" : "신고하기"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
