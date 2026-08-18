"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, X } from "lucide-react";
import { createDueReviewSession, getReviewNudge } from "@/app/mypage/wrong-notes/actions";
import { srsDayIndex } from "@gongmoa/core";
import { claimHomePopup } from "@/lib/home-popup";

// 로그인하고 홈에 들어왔을 때 "복습부터" 하도록 유도하는 모달.
//
// 홈 서버 렌더에 복습 요약을 끼워 넣지 않는다. 요약 계산은 이미지 조회까지 도는
// 무거운 작업인데 홈은 모두가 매번 여는 화면이고, 모달은 하루 한 번만 뜬다.
// 그래서 마운트 후 "오늘 이미 봤는지"를 먼저 로컬에서 확인하고, 안 봤을 때만
// 서버를 부른다 — 두 번째 방문부터는 네트워크 비용이 0이다.
//
// 무료 사용자에게는 뜨지 않는다(서버 액션이 0을 돌려준다). 못 누르는 걸 모달로
// 띄우면 홈 자체를 피하게 된다 — review-due-card.tsx가 홈에 잠긴 카드를 두지 않은
// 이유와 같다.

const STORAGE_KEY = "review-nudge-day";

// 하루 경계는 복습 스케줄과 같은 KST 04:00을 쓴다. 자정 기준이면 새벽 3시에 푼
// 사람에게 두 시간 뒤 같은 모달이 다시 뜬다.
function today(): string {
  return String(srsDayIndex(new Date()));
}

function seenToday(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === today();
  } catch {
    // 시크릿 모드 등 localStorage가 막힌 환경. 매번 뜨는 것보다 안 뜨는 쪽이 낫다.
    return true;
  }
}

function markSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, today());
  } catch {
    // 무시: 저장이 안 되면 다음 방문에 한 번 더 뜰 뿐이다.
  }
}

export function ReviewNudgeModal() {
  const router = useRouter();
  const [nudge, setNudge] = useState<{
    todayCount: number;
    subjects: { name: string; count: number }[];
  } | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seenToday()) return;
    let alive = true;
    getReviewNudge()
      .then((res) => {
        if (!alive || res.todayCount <= 0) return;
        // 홈 팝업은 한 화면에 하나만 뜬다(lib/home-popup.ts). 자리를 못 잡으면 아무
        // 기록도 남기지 않고 물러나, 다음 방문에 다시 기회를 얻는다.
        if (!claimHomePopup()) return;
        // 띄우는 순간 "오늘 봤다"로 기록한다. 닫기를 안 누르고 나가도 같은 날
        // 다시 뜨면 안 된다.
        markSeen();
        setNudge(res);
      })
      .catch(() => {
        // 조회 실패는 조용히 넘긴다. 유도 모달이 에러를 띄울 자리는 아니다.
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!nudge) return null;

  function startReview() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createDueReviewSession();
      if (res.error || !res.sessionId) {
        setError(res.error ?? "복습을 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center"
      onClick={() => setNudge(null)}
    >
      <div
        className="flex w-full max-w-sm flex-col gap-3 rounded-2xl bg-white p-5 dark:bg-zinc-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-2">
          <CalendarCheck size={18} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="min-w-0 flex-1">
            <p className="font-bold">
              오늘 복습할{" "}
              <span className="text-blue-600 dark:text-blue-400">{nudge.todayCount}문항</span>
            </p>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-500">
              {nudge.subjects.length > 0
                ? nudge.subjects.map((s) => `${s.name} ${s.count}`).join(" · ")
                : "복습 예정 문항을 모았어요"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNudge(null)}
            aria-label="닫기"
            className="shrink-0 text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          새 문제를 풀기 전에 오늘 몫만 끝내면 돼요. 몇 분이면 끝나요.
        </p>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setNudge(null)}
            className="flex-1 rounded-lg border border-zinc-200 py-2.5 text-sm font-medium text-zinc-600 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800"
          >
            나중에
          </button>
          <button
            type="button"
            onClick={startReview}
            disabled={pending}
            className="flex-[1.6] rounded-lg bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? "여는 중..." : "복습 시작"}
          </button>
        </div>
      </div>
    </div>
  );
}
