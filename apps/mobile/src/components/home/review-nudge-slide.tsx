import { srsDayIndex } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { CalendarCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { markSeenThisSession, seenThisSession, type HomePopupControls, type HomePopupSource } from "./home-popup";
import { AppText } from "../app-text";
import { handleEdgeError } from "../../lib/edge";
import { fetchReviewNudge, useStartDueSession } from "../../queries/review-due";
import { themedIcon } from "../../theme/icons";

// 로그인하고 홈에 들어왔을 때 "복습부터" 하도록 유도하는 장.
// 웹 apps/web/src/components/review-nudge-slide.tsx 대응.
//
// 무료 사용자에게는 뜨지 않는다 — 서버(EF `review-due {action:"nudge"}`)가 403 을 주고
// fetchReviewNudge 가 그것을 null 로 바꾼다. 못 누르는 걸 띄우면 홈 자체를 피하게 된다
// (review-due-card.tsx 가 홈에 잠긴 카드를 두지 않은 이유와 같다).
//
// 홈 서버 조회에 복습 요약을 끼워 넣지 않는 것도 웹과 같다: 요약 계산은 이미지 조회까지 도는
// 무거운 작업인데 홈은 매번 여는 화면이고 이 장은 하루 한 번만 뜬다. 그래서 "오늘 이미 봤는지"
// 를 먼저 본 다음에만 서버를 부른다 — 두 번째 방문부터는 왕복이 0이다.
//
// 홈 팝업 슬라이드 중 유일하게 서버를 봐야 하는 장이라 판이 이미 열린 뒤에 도착할 수 있다.
// 슬라이더는 그것을 "늦게 도착한 장"으로 이미 다룬다(home-popup-slider.tsx).
//
// 빈도: 하루 한 번. 하루 경계는 복습 스케줄과 같은 KST 04:00(core srsDayIndex)을 쓴다 —
// 자정 기준이면 새벽 3시에 푼 사람에게 두 시간 뒤 같은 안내가 다시 뜬다.
// 키는 `review-fab:<srsDayIndex>` 와 같은 규칙으로 **메모리 전용**이다(설계서 §4.5 #30·#16).
// 웹은 localStorage 를 쓰지만, 앱에서 이 값을 kv 에 적으면 "오늘"이 넘어가도 남아 있는
// 날짜 키가 디스크에 쌓인다 — 하루짜리 값이라 굳이 디스크로 내려보낼 이유가 없다.
const SHOWN_KEY_PREFIX = "review-nudge-day:";

function todayKey(): string {
  return `${SHOWN_KEY_PREFIX}${srsDayIndex(new Date())}`;
}

export type ReviewNudge = { todayCount: number; subjects: { name: string; count: number }[] };

export const reviewNudgeSource: HomePopupSource = {
  id: "review-nudge",
  resolve: async ({ signedIn }) => {
    // 비회원은 서버를 부르지 않는다 — EF 가 401 을 줄 것이 뻔하고, 그 자리는 "오늘 복습"이
    // 아니라 로그인을 권할 자리도 아니다(홈 팝업에 잠긴 장을 싣지 않는다).
    if (!signedIn || seenThisSession(todayKey())) return null;
    const nudge = await fetchReviewNudge();
    if (!nudge || nudge.todayCount <= 0) return null;
    return {
      id: "review-nudge",
      title: "오늘의 복습",
      onShown: () => markSeenThisSession(todayKey()),
      // 버튼이 본문 상태(여는 중·에러)를 함께 쓰므로 고정 띠(footer)로 떼어내지 않고 본문에
      // 둔다. 짧은 장이라 스크롤될 일도 없다(웹과 같은 판단).
      body: (controls) => <ReviewNudgeBody nudge={nudge} {...controls} />,
    };
  },
};

const CalendarIcon = themedIcon(CalendarCheck);

export function ReviewNudgeBody({ nudge, close, dismiss }: { nudge: ReviewNudge } & HomePopupControls) {
  const start = useStartDueSession("create");
  const [error, setError] = useState<string | null>(null);
  const pending = start.isPending;

  async function startReview() {
    if (pending) return;
    setError(null);
    try {
      const res = await start.mutateAsync();
      close();
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, { next: "/" });
      if (handled.redirected) return;
      setError(handled.message || "복습을 시작하지 못했어요.");
    }
  }

  return (
    <View className="gap-3 p-5">
      {/* pr-7 — 판 오른쪽 위의 닫기(X) 자리를 비워 둔다. */}
      <View className="flex-row items-start gap-2 pr-7">
        <View className="mt-0.5">
          <CalendarIcon size={18} colorClassName="text-blue-600 dark:text-blue-400" />
        </View>
        <View className="min-w-0 flex-1">
          <AppText weight="bold">
            오늘 복습할{" "}
            <AppText weight="bold" className="text-blue-600 dark:text-blue-400">
              {nudge.todayCount}문항
            </AppText>
          </AppText>
          <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-500" pretty>
            {nudge.subjects.length > 0
              ? nudge.subjects.map((s) => `${s.name} ${s.count}`).join(" · ")
              : "복습 예정 문항을 모았어요"}
          </AppText>
        </View>
      </View>

      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
        새 문제를 풀기 전에 오늘 몫만 끝내면 돼요. 몇 분이면 끝나요.
      </AppText>

      {error && (
        <AppText variant="xs" className="text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      {/* "나중에"는 이 장만 치우고 다음 장으로 넘어간다 — 복습을 미룬 사람에게도 뒤에 실린
          안내는 볼 기회가 있어야 한다. */}
      <View className="flex-row gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={dismiss}
          className="flex-1 items-center rounded-lg border border-zinc-200 py-2.5 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"
        >
          <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
            나중에
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: pending }}
          disabled={pending}
          onPress={() => void startReview()}
          className={[
            "flex-[1.6] items-center rounded-lg bg-blue-600 py-2.5 active:bg-blue-700",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <AppText variant="sm" weight="bold" className="text-white">
            {pending ? "여는 중..." : "복습 시작"}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
