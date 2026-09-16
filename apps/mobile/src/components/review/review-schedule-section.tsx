import { CalendarClock } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../app-text";
import { ForecastStrip } from "../mypage/review-due-card";
import { useReviewSchedule } from "../../queries/review-due";
import { themedIcon } from "../../theme/icons";
import type { ReviewSessionDetail } from "../../queries/review";

// 채점 결과 화면의 "다음 복습 예약" 섹션(웹 review-schedule-section.tsx + ForecastStrip).
// 멤버십 전용 — 방금 푼 문항이 각각 언제 다시 나오는지 보여준다(틀린 건 내일, 맞힌 건 며칠
// 뒤로 갈리는 게 여기서 눈에 보인다).
//
// 맞힌 문항이 다시 나온다는 걸 여기서 먼저 알려두지 않으면, 나중에 큐에서 만났을 때 버그로
// 인식한다. "극복"과 "복습 예약"은 다른 개념이라는 걸 이 자리에서 가르친다.
//
// 값은 EF `review-due {action:"schedule"}`(§6.7 #12)가 준다 — 무료 회원(403)·남의 세션·채점
// 전 세션은 전부 null 이고 **오류를 그리지 않는다**. 스케줄을 못 불러와도 채점 결과 화면은
// 멀쩡해야 한다(웹과 같은 판단).
const ClockIcon = themedIcon(CalendarClock);

export function ReviewScheduleSection({ view }: { view: ReviewSessionDetail }) {
  // 채점 전 세션에는 스케줄이 없다(서버도 null 을 준다) — 부르지 않고 끝낸다.
  const { data: schedule } = useReviewSchedule(view.submitted ? view.sessionId : "");
  if (!schedule) return null;

  const scheduled = schedule.items.filter((it) => it.dueInDays != null);
  if (scheduled.length === 0) return null;

  return (
    <View className="gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <View>
        <View className="flex-row items-center gap-1.5">
          <ClockIcon size={16} colorClassName="text-blue-900 dark:text-blue-100" />
          <AppText variant="sm" weight="bold" className="text-blue-900 dark:text-blue-100">
            다음 복습 예약
          </AppText>
        </View>
        <AppText variant="xs" className="text-blue-700 dark:text-blue-300" pretty>
          맞힌 문제도 간격을 두고 다시 나와요 — 한 번 맞힌 것과 아는 것은 다르니까요
        </AppText>
      </View>

      <ForecastStrip forecast={schedule.forecast} />

      <View className="gap-1.5">
        {scheduled.map((it) => (
          <View key={it.position} className="flex-row items-center justify-between gap-3">
            <AppText
              variant="xs"
              numberOfLines={1}
              className="min-w-0 flex-1 text-blue-800 dark:text-blue-200"
            >
              {it.paperTitle ? `${it.paperTitle} ${it.questionNumber}번` : `${it.position + 1}번 문항`}
            </AppText>
            <AppText
              variant="xs"
              weight="bold"
              tabular
              className="shrink-0 text-blue-900 dark:text-blue-100"
            >
              {it.dueInDays === 0 ? "오늘 다시" : it.dueInDays === 1 ? "내일" : `${it.dueInDays}일 뒤`}
            </AppText>
          </View>
        ))}
      </View>
    </View>
  );
}
