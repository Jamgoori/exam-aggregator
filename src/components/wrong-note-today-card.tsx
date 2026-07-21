"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { createReviewAll } from "@/app/mypage/wrong-notes/actions";

// 마이페이지 최상단 "오늘 할 일" 카드. 전 과목 미극복 오답을 한 번에 다시 푼다.
// (복습 대상 수 = 미극복 수와 항상 일치 — 채점 후 극복한 만큼만 줄어든다.)
// 설명·과목별 진입은 오답노트 탭에 있으니 이 카드는 상태 한 줄 + CTA만 둔다.
export function WrongNoteTodayCard({
  unresolvedTotal,
}: {
  unresolvedTotal: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function launch() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createReviewAll({});
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
      <div className="flex flex-col gap-3 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 p-4 text-white sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold opacity-85">오늘 할 일</p>
          <h3 className="mt-0.5 text-base font-bold">오답을 모두 극복했어요 🎉</h3>
        </div>
        <Link
          href="/"
          className="inline-block shrink-0 rounded-lg bg-white px-4 py-2 text-sm font-bold text-emerald-700"
        >
          새 문제 풀러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-500 p-4 text-white">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold opacity-85">오늘 할 일</p>
          <h3 className="mt-0.5 text-base font-bold">다시 풀 오답 {unresolvedTotal}개</h3>
        </div>
        <button
          type="button"
          onClick={launch}
          disabled={pending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 py-2 text-sm font-bold text-blue-700 disabled:opacity-70"
        >
          <RotateCcw size={15} />
          {pending ? "준비 중..." : "지금 다시 풀기"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-100">{error}</p>}
    </div>
  );
}
