"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { createReviewAll } from "@/app/mypage/wrong-notes/actions";

// 마이페이지 최상단 "오늘 할 일" 카드. 전 과목 미극복 오답을 한 번에 다시 푼다.
// (복습 대상 수 = 미극복 수와 항상 일치 — 채점 후 극복한 만큼만 줄어든다.)
export function WrongNoteTodayCard({
  unresolvedTotal,
  topSubjectSlug,
}: {
  unresolvedTotal: number;
  // 보조 "시험지 보기" 링크가 향하는 대표 과목(미극복 최다). 없으면 링크 숨김.
  topSubjectSlug: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function launch(opts: { includeResolved?: boolean }) {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewAll(opts);
      if (res.error || !res.sessionId) {
        setError(res.error ?? "시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  // 전부 극복
  if (unresolvedTotal <= 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white">
        <p className="text-xs font-semibold opacity-85">오늘 할 일</p>
        <h3 className="mt-1.5 text-lg font-bold">오답을 모두 극복했어요 🎉</h3>
        <p className="mt-1 text-sm opacity-90">
          새 기출을 풀어 약점을 더 찾아볼까요? 틀린 문제는 자동으로 여기 모여요.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <Link
            href="/"
            className="inline-block rounded-lg bg-white px-4 py-2 text-sm font-bold text-emerald-700"
          >
            새 문제 풀러 가기
          </Link>
          <button
            type="button"
            onClick={() => launch({ includeResolved: true })}
            disabled={pending}
            className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/25 disabled:opacity-60"
          >
            {pending ? "준비 중..." : "극복한 문항 다시 풀기"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 p-5 text-white">
      <p className="text-xs font-semibold opacity-85">오늘 할 일</p>
      <h3 className="mt-1.5 text-lg font-bold">복습할 문항 {unresolvedTotal}개가 기다려요</h3>
      <p className="mt-1 text-sm opacity-90">
        아직 못 넘긴 오답이에요. 과목 상관없이 한 번에 섞어 풀어 극복해요.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => launch({})}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-70"
        >
          <RotateCcw size={15} />
          {pending ? "준비 중..." : "복습 시작하기"}
        </button>
        {topSubjectSlug && (
          <Link
            href={`/mypage/wrong-notes/${topSubjectSlug}`}
            className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/25"
          >
            시험지 보기
          </Link>
        )}
      </div>
      {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
    </div>
  );
}
