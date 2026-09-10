"use client";

import { useState, useTransition } from "react";
import { Flag, X } from "lucide-react";
import {
  submitQuestionReport,
  type QuestionReportContext,
  type QuestionReportReason,
} from "@/app/papers/actions";

const REASONS: { value: QuestionReportReason; label: string }[] = [
  { value: "wrong_answer", label: "정답이 잘못된 것 같아요" },
  { value: "wrong_explanation", label: "해설에 오류가 있어요" },
  { value: "image_issue", label: "이미지/문제 표시에 문제가 있어요" },
  { value: "other", label: "기타" },
];

// 해설/CBT 화면 어디서나 붙일 수 있는 작은 신고 버튼. 트리거 옆에 붙는 팝오버로
// 만들었더니, CBT 문제별 풀기(모바일)에서는 트리거가 화면 가운데 근처에 있어
// 고정폭 팝오버가 화면 왼쪽 밖으로 잘려 나가는 문제가 있었다 — 트리거 위치와
// 무관하게 항상 화면 안에 들어오도록 가운데 정렬 모달로 바꿨다(cbt-result-modal
// 과 같은 패턴).
export function ReportQuestionButton({
  paperId,
  questionNumber,
  context,
}: {
  paperId: string;
  questionNumber: number;
  context: QuestionReportContext;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<QuestionReportReason | null>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<{ error?: string; success?: boolean } | null>(null);

  // CBT 응시 중에는 아직 채점 전이라 정답도 해설도 보여주지 않는다 — "정답이
  // 잘못됐다"/"해설에 오류가 있다"는 채점·해설 열람 후에나 판단할 수 있는 사유라
  // 응시 화면에서는 이미지/문제 표시 오류와 기타만 남긴다.
  const reasons =
    context === "cbt"
      ? REASONS.filter((r) => r.value !== "wrong_answer" && r.value !== "wrong_explanation")
      : REASONS;

  function close() {
    setOpen(false);
    setReason(null);
    setMessage("");
    setResult(null);
  }

  function submit() {
    if (!reason || pending) return;
    startTransition(async () => {
      const res = await submitQuestionReport({
        paperId,
        questionNumber,
        context,
        reason,
        message,
      });
      setResult(res);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`${questionNumber}번 문항 오류 신고`}
        className="flex items-center justify-center rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 print:hidden dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-red-400"
      >
        <Flag size={14} />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
          onClick={close}
        >
          <div
            className="w-full max-w-sm rounded-2xl bg-white p-5 text-left shadow-xl dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            {result?.success ? (
              <div className="flex flex-col items-center gap-3 py-2 text-center">
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  신고가 접수됐어요. 확인 후 반영할게요.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-zinc-100 px-4 py-1.5 text-sm font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  닫기
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    {questionNumber}번 문항 오류 신고
                  </p>
                  <button
                    type="button"
                    onClick={close}
                    aria-label="닫기"
                    className="rounded-full p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-400"
                  >
                    <X size={16} />
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  {reasons.map((r) => (
                    <label
                      key={r.value}
                      className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-400"
                    >
                      <input
                        type="radio"
                        name={`report-reason-${paperId}-${questionNumber}-${context}`}
                        checked={reason === r.value}
                        onChange={() => setReason(r.value)}
                      />
                      {r.label}
                    </label>
                  ))}
                </div>
                <textarea
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="자세히 알려주시면 도움이 돼요 (선택)"
                  maxLength={500}
                  rows={2}
                  className="w-full resize-none rounded-lg border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
                {result?.error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={!reason || pending}
                    onClick={submit}
                    className="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pending ? "제출 중..." : "신고하기"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
