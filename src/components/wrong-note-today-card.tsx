"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shuffle, RotateCcw } from "lucide-react";
import { createReviewAll } from "@/app/mypage/wrong-notes/actions";

// 오답노트 허브 최상단 "오늘 카드". 전 과목을 한 번에 다룬다(과목을 가리지 않음):
// (1) 복습 대상(하루 지난 미극복)이 있으면 전 과목 복습, (2) 아니면 전 과목 미극복
// 섞어풀기, (3) 전부 극복이면 축하. 극복한 문항까지 다시 풀고 싶으면 하단 링크로.
export function WrongNoteTodayCard({
  unresolvedTotal,
  dueTotal,
  topSubjectSlug,
}: {
  unresolvedTotal: number;
  dueTotal: number;
  // 보조 "문항 모아보기" 링크가 향하는 대표 과목(미극복 최다). 없으면 링크 숨김.
  topSubjectSlug: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function launch(opts: { onlyDue?: boolean; includeResolved?: boolean }) {
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

  // (3) 전부 극복
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

  const isReview = dueTotal > 0;

  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white">
      <p className="flex items-center gap-1 text-xs font-semibold opacity-85">
        {isReview ? <RotateCcw size={13} /> : <Shuffle size={13} />} 오늘 할 일
      </p>
      <h3 className="mt-1.5 text-lg font-bold">
        {isReview
          ? `복습할 문항 ${dueTotal}개가 기다려요`
          : `미극복 ${unresolvedTotal}문항, 섞어서 다시 풀어요`}
      </h3>
      <p className="mt-1 text-sm opacity-90">
        {isReview
          ? "하루 전에 틀린 문제예요. 과목 상관없이 모아서 잊기 전에 극복해요."
          : "여러 과목 오답을 한 번에 섞어 풀어요. 맞히면 자동으로 극복 처리돼요."}
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => launch(isReview ? { onlyDue: true } : {})}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-70"
        >
          {isReview ? <RotateCcw size={15} /> : <Shuffle size={15} />}
          {pending ? "준비 중..." : isReview ? "복습 시작하기" : "섞어풀기 시작"}
        </button>
        {topSubjectSlug && (
          <Link
            href={`/mypage/wrong-notes/${topSubjectSlug}?view=questions`}
            className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/25"
          >
            문항 모아보기
          </Link>
        )}
      </div>
      <button
        type="button"
        onClick={() => launch({ includeResolved: true })}
        disabled={pending}
        className="mt-2.5 text-xs font-medium text-blue-100 underline underline-offset-2 hover:text-white disabled:opacity-60"
      >
        극복한 문항까지 전체 다시 풀기
      </button>
      {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
    </div>
  );
}
