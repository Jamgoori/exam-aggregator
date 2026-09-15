import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  attendanceMilestoneDates,
  attendanceProgress,
  daysInMonthKey,
  type AttendanceMilestone,
  type AttendanceSummary,
} from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router, type Href } from "expo-router";
import { CalendarCheck, Check, Gift, PartyPopper, Sparkles } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { tokens, useIsDark } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 마이페이지 월간 출석 카드(웹 attendance-card.tsx, 설계서 §4.5 #26). 화면이 규칙을 다시 적지
// 않는다 — 단계·최소 문항 수·월 최대 일수는 전부 core attendance.ts 에서 온다. 무료·유료를
// 가르지 않고 모두에게 보여준다(잠긴 카드가 아니다). isAttendanceOpen() 일 때만 마운트된다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const CalendarIcon = themedIcon(CalendarCheck);
const SparklesIcon = themedIcon(Sparkles);
const PartyIcon = themedIcon(PartyPopper);
// 단계를 채운 날의 선물색(웹 from-amber-400 to-orange-500).
const REWARD_GRADIENT = ["#ffb900", "#ff6900"] as const;

export function AttendanceCard({ month, today, attendedDates, todayQuestions, grantedMilestones }: AttendanceSummary) {
  const dark = useIsDark();
  const attended = new Set(attendedDates);
  const granted = new Set(grantedMilestones);
  const progress = attendanceProgress(attended.size);
  const attendedToday = attended.has(today);
  // 어느 칸에 축하를 그릴지 — 단계를 채운 그 날의 칸이다(core attendanceMilestoneDates — 웹 달력과
  // 같은 칸에 같은 표시).
  const milestoneDates = attendanceMilestoneDates(attendedDates);
  const todayMilestone = milestoneDates.get(today) ?? null;

  const monthLabel = Number(month.slice(5, 7));
  const lastDay = daysInMonthKey(month);
  const todayDay = today.startsWith(month.slice(0, 8)) ? Number(today.slice(8, 10)) : 0;
  // 그 달 1일의 요일(0=일). UTC 로 계산해 기기 시간대의 영향을 받지 않는다.
  const firstWeekday = new Date(`${month}T00:00:00Z`).getUTCDay();

  // 달력 칸을 주 단위로 접는다(빈 칸 + 1..말일 + 끝 빈 칸).
  const cells: (number | null)[] = [...Array.from({ length: firstWeekday }, () => null), ...Array.from({ length: lastDay }, (_, i) => i + 1)];
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  return (
    <View className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* 머리: 이 달에 몇 일을 벌었나. 카드에서 제일 먼저 읽혀야 하는 숫자다. */}
      <LinearGradient
        // 웹 from-blue-50 to-white / dark:from-blue-950/40 dark:to-zinc-900 — blue-* 는 재매핑 토큰(초록)이라
        // 진짜 Tailwind 파랑 hex 를 박으면 웹과 다른 색이 된다. 40% 는 #RRGGBBAA(0x66).
        colors={dark ? [`${tokens.dark.blue[950]}66`, "#18181b"] : [tokens.light.blue[50], "#ffffff"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-row flex-wrap items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4 dark:border-zinc-800"
      >
        <View className="flex-row items-center gap-2">
          <CalendarIcon size={18} colorClassName="text-blue-600 dark:text-blue-400" />
          <AppText variant="base" weight="semibold" className="text-zinc-900 dark:text-zinc-100">
            {monthLabel}월 출석
          </AppText>
          <View className="rounded-full bg-blue-100 px-2 py-0.5 dark:bg-blue-500/15">
            <AppText variant="xs" weight="medium" allowFontScaling={false} className="text-blue-700 dark:text-blue-300">
              {attended.size}일
            </AppText>
          </View>
        </View>
        <View className="flex-row items-baseline gap-1.5">
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
            멤버십
          </AppText>
          <AppText variant="2xl" weight="bold" tabular className="text-blue-600 dark:text-blue-400">
            {progress.earnedDays}
          </AppText>
          <AppText variant="sm" weight="medium" className="text-zinc-400 dark:text-zinc-500">
            / {ATTENDANCE_MONTHLY_MAX_DAYS}일
          </AppText>
        </View>
      </LinearGradient>

      <View className="gap-5 px-5 py-5">
        {/* 단계 막대. 칸 하나가 단계 하나를 맡고, 그 칸 안에서만 채워진다. */}
        <View className="gap-2">
          <View className="flex-row gap-1">
            {ATTENDANCE_MILESTONES.map((m, i) => {
              const from = i === 0 ? 0 : ATTENDANCE_MILESTONES[i - 1].days;
              const ratio = Math.max(0, Math.min(1, (attended.size - from) / (m.days - from)));
              return (
                <View key={m.days} className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <View className="h-full rounded-full bg-blue-500 dark:bg-blue-400" style={{ width: `${ratio * 100}%` }} />
                </View>
              );
            })}
          </View>

          <View className="flex-row gap-1">
            {ATTENDANCE_MILESTONES.map((m) => {
              const done = attended.size >= m.days;
              const textCls = done ? "text-blue-600 dark:text-blue-400" : "text-zinc-300 dark:text-zinc-600";
              return (
                <View
                  key={m.days}
                  className={["flex-1 items-center gap-0.5 rounded-lg py-1.5", done ? "bg-blue-50 dark:bg-blue-500/10" : "bg-zinc-50 dark:bg-zinc-800/50"].join(" ")}
                >
                  <AppText variant="xs" weight="medium" allowFontScaling={false} className={done ? "text-blue-700 dark:text-blue-300" : "text-zinc-400 dark:text-zinc-500"}>
                    {m.days}일
                  </AppText>
                  {/* "+1일"이 아니라 "멤버십 +1일". 지급 완료 체크는 원장(granted)에 실제로 남은 것만. */}
                  <View className="flex-row flex-wrap items-center justify-center gap-x-0.5">
                    {granted.has(m.days) && <Check size={10} strokeWidth={3} color={done ? (dark ? tokens.dark.blue[400] : tokens.light.blue[600]) : "#d4d4d8"} />}
                    <AppText variant="10" weight="semibold" allowFontScaling={false} className={["text-center", textCls].join(" ")}>
                      멤버십 +{m.grantDays}일
                    </AppText>
                  </View>
                </View>
              );
            })}
          </View>
        </View>

        {/* 달력. 도장을 눈으로 세게 한다 — 숫자만 있으면 "내가 언제 빠졌지"가 안 보인다. */}
        <View className="gap-1.5">
          <View className="flex-row gap-1">
            {WEEKDAYS.map((w, i) => (
              <AppText
                key={w}
                variant="11"
                weight="medium"
                allowFontScaling={false}
                className={["flex-1 text-center", i === 0 ? "text-red-400 dark:text-red-400/70" : "text-zinc-400 dark:text-zinc-500"].join(" ")}
              >
                {w}
              </AppText>
            ))}
          </View>
          <View className="gap-1">
            {weeks.map((week, wi) => (
              <View key={wi} className="flex-row gap-1">
                {week.map((day, di) => {
                  if (day === null) return <View key={`pad-${wi}-${di}`} className="flex-1 aspect-square" />;
                  const date = `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
                  const stamped = attended.has(date);
                  const isToday = day === todayDay;
                  const future = todayDay > 0 && day > todayDay;
                  const reward = milestoneDates.get(date) ?? null;
                  return <DayCell key={date} day={day} stamped={stamped} isToday={isToday} future={future} reward={reward} />;
                })}
              </View>
            ))}
          </View>

          {/* 달력에 처음 보는 색이 생겼으니 한 줄로 뜻을 붙인다. 받은 날이 없으면 아무 말도 하지 않는다. */}
          {milestoneDates.size > 0 && (
            <View className="flex-row items-center gap-1.5">
              <LinearGradient colors={[...REWARD_GRADIENT]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} className="h-4 w-4 items-center justify-center rounded">
                <Gift size={10} strokeWidth={2.5} color="#ffffff" />
              </LinearGradient>
              <AppText variant="11" className="text-zinc-500 dark:text-zinc-400">
                멤버십을 받은 날이에요
              </AppText>
            </View>
          )}
        </View>

        <TodayLine
          attendedToday={attendedToday}
          todayQuestions={todayQuestions}
          todayMilestone={todayMilestone}
          daysToNext={progress.daysToNext}
          nextDays={progress.next?.days ?? null}
          nextGrant={progress.next?.grantDays ?? null}
        />
      </View>
    </View>
  );
}

function DayCell({
  day,
  stamped,
  isToday,
  future,
  reward,
}: {
  day: number;
  stamped: boolean;
  isToday: boolean;
  future: boolean;
  reward: AttendanceMilestone | null;
}) {
  // 오늘은 테두리로만 표시한다. 도장과 색으로 겨루면 둘 다 안 읽힌다.
  const ring = isToday ? (stamped ? "border-2 border-blue-300 dark:border-blue-300/60" : "border-2 border-blue-400 dark:border-blue-500") : "";
  const label = reward ? `${day}일 — ${reward.days}일 달성, 멤버십 +${reward.grantDays}일` : stamped ? `${day}일 출석` : `${day}일`;
  if (reward) {
    return (
      <LinearGradient
        colors={[...REWARD_GRADIENT]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        accessibilityLabel={label}
        className={["flex-1 aspect-square items-center justify-center rounded-lg", ring].join(" ")}
      >
        <Gift size={13} strokeWidth={2.5} color="#ffffff" />
      </LinearGradient>
    );
  }
  return (
    <View
      accessibilityLabel={label}
      className={[
        "flex-1 aspect-square items-center justify-center rounded-lg",
        stamped ? "bg-blue-500" : future ? "" : "bg-zinc-50 dark:bg-zinc-800/60",
        ring,
      ].join(" ")}
    >
      {stamped ? (
        <Check size={13} strokeWidth={3} color="#ffffff" />
      ) : (
        <AppText variant="xs" tabular allowFontScaling={false} className={future ? "text-zinc-300 dark:text-zinc-700" : "text-zinc-400 dark:text-zinc-500"}>
          {day}
        </AppText>
      )}
    </View>
  );
}

// 카드에서 유일하게 행동을 부르는 줄. 위쪽이 "지금까지"라면 여기는 "다음에 뭘 하면 되나"다.
function TodayLine({
  attendedToday,
  todayQuestions,
  todayMilestone,
  daysToNext,
  nextDays,
  nextGrant,
}: {
  attendedToday: boolean;
  todayQuestions: number;
  todayMilestone: AttendanceMilestone | null;
  daysToNext: number | null;
  nextDays: number | null;
  nextGrant: number | null;
}) {
  const dark = useIsDark();
  // 오늘 단계를 채웠다면 그 말이 제일 위다. 한 달에 다섯 번뿐인 순간이라 색을 바꾼다.
  if (todayMilestone) {
    return (
      <LinearGradient
        colors={dark ? ["rgba(254,154,0,0.1)", "rgba(255,105,0,0.1)"] : ["#fffbeb", "#fff7ed"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        className="flex-row items-start gap-2 rounded-xl border border-amber-200 px-4 py-3 dark:border-amber-500/30"
      >
        <View className="mt-0.5">
          <PartyIcon size={17} colorClassName="text-amber-600 dark:text-amber-400" />
        </View>
        <AppText variant="sm" className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-200" pretty>
          <AppText variant="sm" weight="bold" className="text-amber-700 dark:text-amber-300">
            축하해요!
          </AppText>{" "}
          오늘로 {todayMilestone.days}일 출석을 채워{" "}
          <AppText variant="sm" weight="semibold">
            멤버십 +{todayMilestone.grantDays}일
          </AppText>
          을 받았어요.
          {daysToNext !== null && nextDays !== null && nextGrant !== null && (
            <> 다음은 {nextDays}일 단계 — {daysToNext}일 더 오시면 멤버십 {nextGrant}일이 더 붙어요.</>
          )}
        </AppText>
      </LinearGradient>
    );
  }

  if (!attendedToday) {
    const left = Math.max(0, ATTENDANCE_MIN_QUESTIONS - todayQuestions);
    return (
      <View className="flex-row flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <AppText variant="sm" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300" pretty>
          오늘{" "}
          <AppText variant="sm" weight="semibold" className="text-zinc-900 dark:text-zinc-100">
            {todayQuestions} / {ATTENDANCE_MIN_QUESTIONS}문항
          </AppText>
          {" — "}
          {/* 문항 수는 채웠는데 도장이 아직 없는 경계가 있다. 도장은 attendedDates 를 정본으로 두고 문구만 갈라 준다. */}
          {left > 0 ? `${left}문항 더 풀면 오늘 출석이에요.` : "조금만 더 풀면 오늘 출석으로 반영돼요."}
        </AppText>
        <Button label="문제 풀러 가기" onPress={() => router.push("/papers" as Href)} className="shrink-0 rounded-lg px-3 py-1.5" textClassName="font-medium" />
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 dark:bg-blue-500/10">
      <SparklesIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
      <AppText variant="sm" className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-200" pretty>
        {daysToNext === null || nextDays === null || nextGrant === null ? (
          <>
            오늘 출석 완료! 이번 달 보상을{" "}
            <AppText variant="sm" weight="semibold">
              전부
            </AppText>{" "}
            받으셨어요.
          </>
        ) : (
          <>
            오늘 출석 완료!{" "}
            <AppText variant="sm" weight="semibold">
              {daysToNext}일
            </AppText>{" "}
            더 출석하면 {nextDays}일 단계로 멤버십 {nextGrant}일을 더 받아요.
          </>
        )}
      </AppText>
    </View>
  );
}
