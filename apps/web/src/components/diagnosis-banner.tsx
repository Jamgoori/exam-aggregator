"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { requestDiagnosis } from "@/app/mypage/actions";

export type DiagnosisBannerState = "ready" | "pending" | "eligible" | "locked";

// 오답노트 허브의 AI 약점 진단 배너. 상태별로 하나의 행동만 보여준다:
//  ready   → 오늘 리포트 보기
//  pending → 요청됨, 생성 대기(생성기가 채우면 ready로 바뀜)
//  eligible→ "진단 받기" 버튼(요청 생성)
//  locked  → 데이터 문턱 미달 안내
export function DiagnosisBanner({
  initialState,
  hint,
}: {
  initialState: DiagnosisBannerState;
  hint?: string | null;
}) {
  const [state, setState] = useState<DiagnosisBannerState>(initialState);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function request() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await requestDiagnosis();
      if (res.error) {
        setError(res.error);
        return;
      }
      setState(res.status === "ready" ? "ready" : "pending");
    });
  }

  const shell =
    "flex items-center gap-3 rounded-2xl border px-4 py-3.5 border-violet-200 bg-violet-50 dark:border-violet-900/50 dark:bg-violet-950/20";

  if (state === "locked") {
    return (
      <div className={shell}>
        <div className="min-w-0">
          <p className="text-sm font-bold text-violet-900 dark:text-violet-200">
            AI 약점 진단
          </p>
          <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
            {hint ?? "조금 더 풀면 진단을 받을 수 있어요."}
          </p>
        </div>
      </div>
    );
  }

  if (state === "ready") {
    return (
      <Link
        href="/mypage/diagnosis"
        className={`${shell} transition-colors hover:bg-violet-100 dark:hover:bg-violet-950/40`}
      >
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900 dark:text-violet-200">
            오늘의 약점 진단이 준비됐어요
          </p>
          <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
            취약 개념과 과목별 흐름을 확인해보세요
          </p>
        </div>
        <span className="shrink-0 text-lg text-violet-400">›</span>
      </Link>
    );
  }

  if (state === "pending") {
    // 극복법(AI) 생성이 아직 안 됐어도 막대그래프·개념 카드는 데이터만으로 바로
    // 뜬다 — 배너를 그 페이지로 보내는 링크로 두고, 옆에 재시도 버튼을 둔다(극복법
    // 생성이 API 키 미설정 등으로 한 번 실패했을 수 있어 다시 시도할 수 있게).
    return (
      <div className={`${shell} flex-wrap`}>
        <Link
          href="/mypage/diagnosis"
          className="min-w-0 flex-1 transition-colors hover:opacity-80"
        >
          <p className="text-sm font-bold text-violet-900 dark:text-violet-200">
            취약 개념 그래프는 준비됐어요
          </p>
          <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
            눌러서 과목별 틀린 개념부터 확인해보세요 · 맞춤 극복법은 준비 중
          </p>
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </Link>
        <button
          type="button"
          onClick={request}
          disabled={pending}
          className="shrink-0 rounded-lg border border-violet-300 bg-white px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-60 dark:border-violet-800 dark:bg-zinc-900 dark:text-violet-300"
        >
          {pending ? "생성 중..." : "극복법 다시 시도"}
        </button>
      </div>
    );
  }

  // eligible
  return (
    <div className={`${shell} flex-wrap`}>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-bold text-violet-900 dark:text-violet-200">
          AI 약점 진단 받기
          <span className="rounded-full bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
            주 1회
          </span>
        </p>
        <p className="text-xs text-violet-700/80 dark:text-violet-300/70">
          오답을 분석해 취약 개념과 다음에 할 일을 알려드려요
        </p>
        {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
      <button
        type="button"
        onClick={request}
        disabled={pending}
        className="shrink-0 rounded-lg bg-violet-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-violet-700 disabled:opacity-60"
      >
        {pending ? "요청 중..." : "진단 받기"}
      </button>
    </div>
  );
}
