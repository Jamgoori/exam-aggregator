"use client";

import Link from "next/link";
import { Trophy } from "lucide-react";
import type { CbtSubmitResult } from "@/app/papers/actions";
import { DiagnosisProgress } from "@/components/diagnosis-progress";
import { formatDuration } from "@gongmoa/core";

// 채점이 끝나면 화면 전체를 덮고 점수/정답률/풀이시간을 보여주는 결과 모달.
export function CbtResultModal({
  result,
  paperHref,
  onRetry,
}: {
  result: CbtSubmitResult;
  // 문제지 상세 주소. 서버 액션이 쓰는 UUID(paperId)는 링크로 쓸 수 없다.
  paperHref: string;
  onRetry: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-zinc-900">
        <Trophy size={40} className="text-amber-500" />
        <h2 className="text-lg font-semibold dark:text-zinc-100">채점 결과</h2>
        <p className="text-3xl font-bold text-blue-600 dark:text-blue-400">
          {result.score} / {result.totalQuestions}
        </p>
        <div className="flex w-full divide-x divide-zinc-100 rounded-xl border border-zinc-100 dark:divide-zinc-700 dark:border-zinc-700">
          <div className="flex-1 py-3">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">정답률</p>
            <p className="mt-1 font-semibold text-zinc-700 dark:text-zinc-300">
              {Math.round(
                ((result.score ?? 0) / (result.totalQuestions || 1)) * 100,
              )}
              %
            </p>
          </div>
          <div className="flex-1 py-3">
            <p className="text-xs text-zinc-400 dark:text-zinc-500">풀이시간</p>
            <p className="mt-1 font-semibold text-zinc-700 dark:text-zinc-300">
              {formatDuration(result.durationSeconds ?? 0)}
            </p>
          </div>
        </div>
        {/* 채점 직후가 "다음에 또 올 이유"를 심을 유일한 순간이다 — 진단이 몇 회차
            뒤에 열리는지(또는 지금 열렸는지)를 여기서 말한다. 값이 없으면(집계 실패)
            줄을 비운다. */}
        {result.diagnosisProgress && (
          <DiagnosisProgress
            attemptCount={result.diagnosisProgress.attemptCount}
            wrongCount={result.diagnosisProgress.wrongCount}
            compact
          />
        )}
        {/* 틀린 문제가 있으면 채점 직후가 복습 효과가 가장 클 때라, 회차 오답노트로
            바로 이어지는 버튼을 가장 눈에 띄는 자리에 둔다. */}
        {result.attemptId &&
          (result.score ?? 0) < (result.totalQuestions ?? 0) && (
            <Link
              href={`/mypage/attempts/${result.attemptId}`}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              틀린 문제 다시 보기 (
              {(result.totalQuestions ?? 0) - (result.score ?? 0)}문제)
            </Link>
          )}
        <div className="flex w-full gap-2">
          <Link
            href={paperHref}
            className="flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800/50"
          >
            문제지로
          </Link>
          <button
            type="button"
            onClick={onRetry}
            className="flex-1 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            다시 풀기
          </button>
        </div>
      </div>
    </div>
  );
}
