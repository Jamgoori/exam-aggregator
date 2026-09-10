"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck } from "lucide-react";
import { createDueReviewSession, getReviewNudge } from "@/app/mypage/wrong-notes/actions";
import { srsDayIndex } from "@gongmoa/core";
import type { HomePopupControls, HomePopupSource } from "@/lib/home-popup";
import { readReviewFabCache, writeReviewFabCache } from "@/components/review-fab";

// 로그인하고 홈에 들어왔을 때 "복습부터" 하도록 유도하는 장.
//
// 홈 서버 렌더에 복습 요약을 끼워 넣지 않는다. 요약 계산은 이미지 조회까지 도는
// 무거운 작업인데 홈은 모두가 매번 여는 화면이고, 이 장은 하루 한 번만 뜬다.
// 그래서 "오늘 이미 봤는지"를 먼저 로컬에서 확인하고, 안 봤을 때만 서버를 부른다 —
// 두 번째 방문부터는 네트워크 비용이 0이다.
//
// 무료 사용자에게는 뜨지 않는다(서버 액션이 0을 돌려준다). 못 누르는 걸 띄우면
// 홈 자체를 피하게 된다 — review-due-card.tsx가 홈에 잠긴 카드를 두지 않은 이유와 같다.
//
// 홈 팝업 슬라이드 셋 중 유일하게 서버를 봐야 하는 장이라, 판이 이미 열린 뒤에
// 도착할 수 있다. 그때는 우선순위 자리에 끼워 넣되 보고 있던 장은 그대로 둔다
// (components/home-popup-slider.tsx).

const STORAGE_KEY = "review-nudge-day";

// 하루 경계는 복습 스케줄과 같은 KST 04:00을 쓴다. 자정 기준이면 새벽 3시에 푼
// 사람에게 두 시간 뒤 같은 안내가 다시 뜬다.
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

type Nudge = { todayCount: number; subjects: { name: string; count: number }[] };

export const reviewNudgeSource: HomePopupSource = {
  id: "review-nudge",
  resolve: async ({ signedIn }) => {
    // 비로그인은 서버가 0을 돌려주고, 0이면 onShown(markSeen)이 돌지 않아 "오늘
    // 봤다"가 영영 기록되지 않는다 — 그래서 예전엔 비로그인 홈 방문마다 서버 액션이
    // 한 번씩 헛돌았다. 로그인했을 때만 묻는다.
    if (!signedIn || seenToday()) return null;
    // 같은 탭에서 "복습 N" 버튼(ReviewFab)이 이미 셌으면 그 값을 쓴다. 0이면 서버를
    // 안 부르고, 양수면 과목 내역만 한 번 더 받는다.
    const cached = readReviewFabCache();
    if (cached != null && cached <= 0) return null;
    const res = await getReviewNudge();
    writeReviewFabCache(res.todayCount);
    if (res.todayCount <= 0) return null;
    return {
      id: "review-nudge",
      title: "오늘의 복습",
      // 눈앞에 온 순간에만 "오늘 봤다"로 기록한다. 실려만 있다가 못 보고 닫힌
      // 날에는 기록하지 않아 같은 날 다음 방문에 다시 기회를 얻는다.
      onShown: markSeen,
      // 버튼이 본문 상태(여는 중·에러)를 함께 쓰므로 아래 고정 띠(footer)로 떼어내지
      // 않고 본문에 둔다. 짧은 장이라 스크롤될 일도 없다.
      body: (controls) => <ReviewNudgeBody nudge={res} {...controls} />,
    };
  },
};

function ReviewNudgeBody({
  nudge,
  close,
  dismiss,
}: { nudge: Nudge } & HomePopupControls) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function startReview() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createDueReviewSession();
      if (res.error || !res.sessionId) {
        setError(res.error ?? "복습을 시작하지 못했어요.");
        return;
      }
      close();
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  return (
    <div className="flex flex-col gap-3 p-5">
      {/* pr-7 — 판 오른쪽 위의 닫기(X) 자리를 비워 둔다. */}
      <div className="flex items-start gap-2 pr-7">
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
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        새 문제를 풀기 전에 오늘 몫만 끝내면 돼요. 몇 분이면 끝나요.
      </p>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {/* "나중에"는 이 장만 치우고 다음 장으로 넘어간다 — 복습을 미룬 사람에게도
          뒤에 실린 안내는 볼 기회가 있어야 한다. */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={dismiss}
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
  );
}
