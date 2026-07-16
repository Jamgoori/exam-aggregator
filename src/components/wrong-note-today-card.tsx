"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shuffle, Sparkles, RotateCcw } from "lucide-react";
import { createReviewSession } from "@/app/mypage/wrong-notes/actions";

// 오답노트 허브 최상단 "오늘 카드". UX 원칙: 지금 상황에 맞는 단일 행동 하나.
// 우선순위: (1) 복습 대상(하루 지난 미극복)이 있으면 복습, (2) 아니면 미극복 섞어풀기,
// (3) 전부 극복이면 축하. 복습·섞어풀기 모두 원탭으로 세션을 만들어 풀이로 이동한다.
export function WrongNoteTodayCard({
  topSubjectSlug,
  topSubjectName,
  topUnresolved,
  dueSubjectSlug,
  dueSubjectName,
  dueCount,
}: {
  topSubjectSlug: string | null;
  topSubjectName: string | null;
  topUnresolved: number;
  dueSubjectSlug: string | null;
  dueSubjectName: string | null;
  dueCount: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startReview(slug: string, onlyDue: boolean) {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewSession({ subjectSlug: slug, onlyUnresolved: true, onlyDue });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "섞어풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${slug}/review/${res.sessionId}`);
    });
  }

  // (3) 전부 극복
  if (!topSubjectSlug || topUnresolved <= 0) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-5 text-white">
        <p className="text-xs font-semibold opacity-85">오늘 할 일</p>
        <h3 className="mt-1.5 text-lg font-bold">오답을 모두 극복했어요 🎉</h3>
        <p className="mt-1 text-sm opacity-90">
          새 기출을 풀어 약점을 더 찾아볼까요? 틀린 문제는 자동으로 여기 모여요.
        </p>
        <Link
          href="/"
          className="mt-3.5 inline-block rounded-lg bg-white px-4 py-2 text-sm font-bold text-emerald-700"
        >
          새 문제 풀러 가기
        </Link>
      </div>
    );
  }

  // (1) 복습 대상 있음
  if (dueCount > 0 && dueSubjectSlug) {
    return (
      <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white">
        <p className="flex items-center gap-1 text-xs font-semibold opacity-85">
          <RotateCcw size={13} /> 오늘 할 일
        </p>
        <h3 className="mt-1.5 text-lg font-bold">복습할 문항 {dueCount}개가 기다려요</h3>
        <p className="mt-1 text-sm opacity-90">
          {dueSubjectName} · 하루 전에 틀린 문제예요. 잊기 전에 다시 풀어 극복해요.
        </p>
        <div className="mt-3.5 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => startReview(dueSubjectSlug, true)}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-70"
          >
            <RotateCcw size={15} />
            {pending ? "준비 중..." : "복습 시작하기"}
          </button>
          <Link
            href={`/mypage/wrong-notes/${dueSubjectSlug}?view=questions`}
            className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/25"
          >
            문항 모아보기
          </Link>
        </div>
        {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
      </div>
    );
  }

  // (2) 미극복 섞어풀기
  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white">
      <p className="flex items-center gap-1 text-xs font-semibold opacity-85">
        <Sparkles size={13} /> 오늘 할 일
      </p>
      <h3 className="mt-1.5 text-lg font-bold">
        {topSubjectName} 미극복 {topUnresolved}문항
      </h3>
      <p className="mt-1 text-sm opacity-90">
        섞어서 다시 풀어 극복해요. 맞히면 자동으로 극복 처리돼요.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => startReview(topSubjectSlug, false)}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-70"
        >
          <Shuffle size={15} />
          {pending ? "섞는 중..." : "섞어풀기 시작"}
        </button>
        <Link
          href={`/mypage/wrong-notes/${topSubjectSlug}?view=questions`}
          className="rounded-lg bg-white/15 px-3.5 py-2 text-sm font-medium text-white hover:bg-white/25"
        >
          문항 모아보기
        </Link>
      </div>
      {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
    </div>
  );
}
