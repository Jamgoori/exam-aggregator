import { srsDayIndex } from "@gongmoa/core";
import { CalendarCheck } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { markSeenThisSession, seenThisSession, type HomePopupControls, type HomePopupSource } from "./home-popup";
import { AppText } from "../app-text";

// 로그인하고 홈에 들어왔을 때 "복습부터" 하도록 유도하는 장.
// 웹 apps/web/src/components/review-nudge-slide.tsx 대응.
//
// ─────────────────────────────────────────────────────────────────────────────
// **Phase 3 — 지금은 절대 뜨지 않는다(자료원이 아직 없다).**
//
// 웹은 서버 액션 `getReviewNudge()`(오늘 복습할 문항 수 + 과목별 내역)와
// `createDueReviewSession()`(그 자리에서 복습 세션 생성)을 부른다. 앱에서 그 둘에 대응하는
// Edge Function 은 `review-due` 이고, 설계서 §12 로드맵은 그것을 **Phase 3(SRS·믹스)** 로
// 잡아 두었다 — `supabase/functions/` 에 아직 없다. 넛지 수를 다른 데서 끌어다 지어내면
// (예: user_question_status 를 앱에서 세는 식) 웹과 다른 숫자를 보여주게 되고, 그 숫자가
// "오늘 할 일"을 말하는 자리라 틀리면 바로 신뢰를 잃는다. **자료원을 발명하지 않는다.**
//
// Phase 3 에서 할 일은 이 파일 안에서 끝난다:
//   1. `src/queries/review.ts`(다른 담당) 에 `review-due` 호출이 생기면,
//   2. 아래 resolve 를 `seenToday()` → `invokeEdge("review-due")` → `todayCount > 0` 검사로
//      채우고(웹 resolve 와 같은 순서),
//   3. body 는 이미 아래에 그려져 있다 — "복습 시작"만 `review-create` 로 이으면 된다.
// 슬라이더는 이 장을 "늦게 도착한 장"으로 이미 다룰 수 있다(서버를 보는 유일한 장이라
// 판이 열린 뒤에 도착할 수 있고, 그때 우선순위 자리에 끼워 넣는다 — home-popup-slider.tsx).
// ─────────────────────────────────────────────────────────────────────────────
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
  // Phase 3 전까지 언제나 null — `review-due` 가 없으므로 뜰 자격을 판정할 자료가 없다.
  id: "review-nudge",
  resolve: async () => {
    if (seenThisSession(todayKey())) return null;
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

// Phase 3 에서 EF `review-due` 로 채운다(§12 로드맵). 그전에는 null — 넛지 자료원이 없다.
async function fetchReviewNudge(): Promise<ReviewNudge | null> {
  return null;
}

export function ReviewNudgeBody({ nudge, dismiss }: { nudge: ReviewNudge } & HomePopupControls) {
  return (
    <View className="gap-3 p-5">
      {/* pr-7 — 판 오른쪽 위의 닫기(X) 자리를 비워 둔다. */}
      <View className="flex-row items-start gap-2 pr-7">
        <View className="mt-0.5">
          <CalendarCheck size={18} color="#2563eb" />
        </View>
        <View className="min-w-0 flex-1">
          <AppText weight="bold">
            오늘 복습할 <AppText weight="bold" className="text-blue-600 dark:text-blue-400">{nudge.todayCount}문항</AppText>
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

      {/* "나중에"는 이 장만 치우고 다음 장으로 넘어간다 — 복습을 미룬 사람에게도 뒤에 실린
          안내는 볼 기회가 있어야 한다. "복습 시작"은 Phase 3(review-create)에서 잇는다. */}
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
          disabled
          className="flex-[1.6] items-center rounded-lg bg-blue-600 py-2.5 opacity-60"
        >
          <AppText variant="sm" weight="bold" className="text-white">
            복습 시작
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
