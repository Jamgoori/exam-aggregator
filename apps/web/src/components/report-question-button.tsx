"use client";

import { useState, useTransition } from "react";
import { Flag } from "lucide-react";
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

// 해설/CBT 화면 어디서나 붙일 수 있는 작은 신고 버튼. 깃발 아이콘만 있는 트리거를
// 누르면 그 문항 자리 바로 아래에 사유 선택 카드가 뜬다 — 별도 페이지로 이동시키면
// 신고하려던 문항 화면을 잃어버리므로 팝오버로 둔다.
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

  // CBT 응시 중에는 아직 해설이 뜨지 않으므로 "해설에 오류가 있어요"는 의미가 없다.
  const reasons =
    context === "cbt" ? REASONS.filter((r) => r.value !== "wrong_explanation") : REASONS;

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
    <div className="relative print:hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${questionNumber}번 문항 오류 신고`}
        aria-expanded={open}
        className="flex items-center justify-center rounded-full p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-red-500 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-red-400"
      >
        <Flag size={14} />
      </button>

      {open && (
        <>
          {/* 카드 밖을 누르면 닫히도록 하는 투명 오버레이. */}
          <button
            type="button"
            aria-label="닫기"
            onClick={close}
            className="fixed inset-0 z-40 cursor-default"
          />
          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-xl border border-zinc-200 bg-white p-3 text-left shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            {result?.success ? (
              <div className="flex flex-col items-center gap-2 py-1 text-center">
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  신고가 접수됐어요. 확인 후 반영할게요.
                </p>
                <button
                  type="button"
                  onClick={close}
                  className="rounded-lg bg-zinc-100 px-3 py-1 text-xs font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                >
                  닫기
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {questionNumber}번 문항 오류 신고
                </p>
                <div className="flex flex-col gap-1">
                  {reasons.map((r) => (
                    <label
                      key={r.value}
                      className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
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
                  className="w-full resize-none rounded-lg border border-zinc-200 px-2 py-1.5 text-xs text-zinc-800 placeholder:text-zinc-400 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
                />
                {result?.error && (
                  <p className="text-xs text-red-600 dark:text-red-400">{result.error}</p>
                )}
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="rounded-lg px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:text-zinc-500 dark:hover:bg-zinc-800"
                  >
                    취소
                  </button>
                  <button
                    type="button"
                    disabled={!reason || pending}
                    onClick={submit}
                    className="rounded-lg bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {pending ? "제출 중..." : "신고하기"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
