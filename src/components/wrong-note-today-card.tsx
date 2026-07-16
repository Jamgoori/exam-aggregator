"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Shuffle, Sparkles } from "lucide-react";
import { createReviewSession } from "@/app/mypage/wrong-notes/actions";

// 오답노트 허브 최상단 "오늘 카드". UX 원칙: 버튼을 여러 개 늘어놓지 않고 지금
// 상황에 맞는 단일 행동 하나만 제시한다. 지금은 미극복 오답이 가장 많은 과목을
// 골라 원탭 섞어풀기로 연결한다(복습 스케줄·AI 진단이 생기면 그게 우선순위 위로).
export function WrongNoteTodayCard({
  topSubjectSlug,
  topSubjectName,
  topUnresolved,
}: {
  topSubjectSlug: string | null;
  topSubjectName: string | null;
  topUnresolved: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 미극복 오답이 없으면(전부 극복) 축하 카드.
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

  function startShuffle() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewSession({
        subjectSlug: topSubjectSlug!,
        onlyUnresolved: true,
      });
      if (res.error || !res.sessionId) {
        setError(res.error ?? "섞어풀기를 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/${topSubjectSlug}/review/${res.sessionId}`);
    });
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 p-5 text-white">
      <p className="flex items-center gap-1 text-xs font-semibold opacity-85">
        <Sparkles size={13} /> 오늘 할 일
      </p>
      <h3 className="mt-1.5 text-lg font-bold">
        {topSubjectName} 미극복 {topUnresolved}문항
      </h3>
      <p className="mt-1 text-sm opacity-90">
        잊기 전에 다시 풀어 극복해요. 맞히면 자동으로 극복 처리돼요.
      </p>
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={startShuffle}
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
