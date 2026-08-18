import { Text, View } from "react-native";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  attendanceMilestoneDates,
  attendanceProgress,
  daysInMonthKey,
  type AttendanceMilestone,
} from "@gongmoa/core";
import { useColors, type Colors } from "../theme/colors";
import type { AttendanceSummary } from "../lib/attendance";

// 마이페이지 월간 출석 카드(앱). 웹 components/attendance-card.tsx 와 같은 구성이다 —
// 단계 막대 → 달력 → 오늘 할 일 한 줄.
//
// 화면이 규칙을 다시 적지 않는다: 단계·최소 문항 수·월 최대 일수는 전부
// @gongmoa/core 의 attendance.ts 에서 온다. 여기에 "7일"이나 "5일"을 직접 쓰면
// 단계를 손볼 때 앱 안내만 옛 값으로 남아 웹과 다른 걸 광고하게 된다.
//
// 색은 테마별로 달라 렌더 중에 useColors() 로 받는다(모듈 스코프에서 읽으면 OS 테마
// 변경을 못 따라간다 — theme/colors.ts 머리말 참고).

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function AttendanceCard({ summary }: { summary: AttendanceSummary }) {
  const colors = useColors();
  const { month, today, attendedDates, todayQuestions, grantedMilestones } = summary;

  const attended = new Set(attendedDates);
  const granted = new Set(grantedMilestones);
  const progress = attendanceProgress(attended.size);
  const attendedToday = attended.has(today);
  // 어느 칸에 축하를 그릴지 — 단계를 채운 그 날의 칸이다. 계산은 core 에 있다
  // (attendanceMilestoneDates): 웹 달력과 같은 칸에 같은 표시가 떠야 한다.
  const milestoneDates = attendanceMilestoneDates(attendedDates);
  const todayMilestone = milestoneDates.get(today) ?? null;

  const monthLabel = Number(month.slice(5, 7));
  const lastDay = daysInMonthKey(month);
  const todayDay = today.startsWith(month.slice(0, 8)) ? Number(today.slice(8, 10)) : 0;
  // 그 달 1일의 요일(0=일). UTC 로 계산해 기기 시간대의 영향을 받지 않는다 —
  // month 자체가 이미 KST 로 정해진 값이라 여기서 또 시간대를 태우면 어긋난다.
  const firstWeekday = new Date(`${month}T00:00:00Z`).getUTCDay();

  // 달력을 7칸씩 주(週)로 자른다. RN 에는 grid 가 없어 flexWrap 대신 행을 직접 만든다 —
  // wrap 에 맡기면 칸 너비가 부모 폭에 따라 흔들려 요일이 어긋난다.
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: lastDay }, (_, i) => i + 1),
  ];
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7);
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  return (
    <View
      style={{
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      {/* 머리: 이 달에 몇 일을 벌었나. 카드에서 제일 먼저 읽혀야 하는 숫자다. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          paddingHorizontal: 14,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>
            {monthLabel}월 출석
          </Text>
          <Text
            style={{
              fontSize: 11,
              fontWeight: "600",
              color: colors.primary,
              backgroundColor: tint(colors),
              borderRadius: 999,
              paddingHorizontal: 7,
              paddingVertical: 2,
              overflow: "hidden",
            }}
          >
            {attended.size}일
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "baseline", gap: 4 }}>
          <Text style={{ fontSize: 11, color: colors.textMuted }}>멤버십</Text>
          <Text style={{ fontSize: 20, fontWeight: "800", color: colors.primary }}>
            {progress.earnedDays}
          </Text>
          <Text style={{ fontSize: 12, fontWeight: "600", color: colors.textMuted }}>
            / {ATTENDANCE_MONTHLY_MAX_DAYS}일
          </Text>
        </View>
      </View>

      <View style={{ padding: 14, gap: 16 }}>
        {/* 단계 막대. 칸 하나가 단계 하나를 맡고 그 칸 안에서만 채워진다 —
            막대 하나를 통으로 채우면 "지금 몇 번째 단계인지"가 안 읽힌다. */}
        <View style={{ gap: 8 }}>
          <View style={{ flexDirection: "row", gap: 4 }}>
            {ATTENDANCE_MILESTONES.map((m, i) => {
              const from = i === 0 ? 0 : ATTENDANCE_MILESTONES[i - 1].days;
              const ratio = Math.max(0, Math.min(1, (attended.size - from) / (m.days - from)));
              return (
                <View
                  key={m.days}
                  style={{
                    flex: 1,
                    height: 7,
                    borderRadius: 999,
                    overflow: "hidden",
                    backgroundColor: colors.card,
                  }}
                >
                  <View
                    style={{
                      width: `${ratio * 100}%`,
                      height: "100%",
                      borderRadius: 999,
                      backgroundColor: colors.primary,
                    }}
                  />
                </View>
              );
            })}
          </View>

          <View style={{ flexDirection: "row", gap: 4 }}>
            {ATTENDANCE_MILESTONES.map((m) => {
              const done = attended.size >= m.days;
              return (
                <View
                  key={m.days}
                  style={{
                    flex: 1,
                    alignItems: "center",
                    gap: 1,
                    paddingVertical: 6,
                    borderRadius: 10,
                    backgroundColor: done ? tint(colors) : colors.card,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "600",
                      color: done ? colors.primary : colors.textMuted,
                    }}
                  >
                    {m.days}일
                  </Text>
                  {/* "+1일"이 아니라 "멤버십 +1일"이라고 적는다. 무엇이 늘어나는지
                      쓰지 않으면 포인트·문제 수 같은 다른 걸로 읽힌다 — 이 기능이 파는
                      건 멤버십 기간이므로 그 단어가 칸마다 보여야 한다.
                      단계가 다섯이라 한 줄에 안 들어간다. 줄을 직접 나눠 "멤버십 /
                      +1일" 두 줄로 두면 좁은 기기에서도 글자가 잘리지 않는다. */}
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: "600",
                      textAlign: "center",
                      color: done ? colors.primary : colors.textMuted,
                      opacity: done ? 1 : 0.5,
                    }}
                  >
                    {/* 지급 완료 표시는 원장(granted)에 실제로 남은 것만 붙인다.
                        단계에 닿았는데 지급이 아직이면 체크를 안 띄운다 — 받지도
                        않은 걸 받았다고 하면 문의가 온다. */}
                    {granted.has(m.days) ? "✓ " : ""}멤버십
                  </Text>
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: "700",
                      textAlign: "center",
                      color: done ? colors.primary : colors.textMuted,
                      opacity: done ? 1 : 0.5,
                    }}
                  >
                    +{m.grantDays}일
                  </Text>
                </View>
              );
            })}
          </View>
        </View>

        {/* 달력. 도장을 눈으로 세게 한다 — 숫자만 있으면 "내가 언제 빠졌지"가 안 보인다. */}
        <View style={{ gap: 5 }}>
          <View style={{ flexDirection: "row" }}>
            {WEEKDAYS.map((w, i) => (
              <Text
                key={w}
                style={{
                  flex: 1,
                  textAlign: "center",
                  fontSize: 11,
                  fontWeight: "500",
                  color: i === 0 ? colors.danger : colors.textMuted,
                }}
              >
                {w}
              </Text>
            ))}
          </View>
          {weeks.map((week, wi) => (
            <View key={wi} style={{ flexDirection: "row", gap: 4 }}>
              {week.map((day, di) => (
                <DayCell
                  key={di}
                  day={day}
                  stamped={day != null && attended.has(dateOf(month, day))}
                  // 단계를 채운 날. 도장 대신 선물색으로 칠해 달력만 훑어도 "여기서
                  // 받았다"가 보이게 한다 — 보상이 단계 막대 안에서만 일어나면
                  // 달력은 출석부일 뿐이고, 며칠을 더 와야 하는지가 실감나지 않는다.
                  reward={day != null && milestoneDates.has(dateOf(month, day))}
                  isToday={day != null && day === todayDay}
                  future={day != null && todayDay > 0 && day > todayDay}
                />
              ))}
            </View>
          ))}

          {/* 달력에 처음 보는 색이 생겼으니 한 줄로 뜻을 붙인다. 받은 날이 하나도
              없으면 아무 말도 하지 않는다 — 빈 범례는 화면만 길게 만든다. */}
          {milestoneDates.size > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 5,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: REWARD_COLOR,
                }}
              >
                <Text style={{ fontSize: 9, color: "#ffffff" }}>🎁</Text>
              </View>
              <Text style={{ fontSize: 11, color: colors.textMuted }}>
                멤버십을 받은 날이에요
              </Text>
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

// 보상을 받은 날의 색. 도장(강조색)과 겨루지 않게 다른 계열이어야 해서 테마
// 팔레트(primary/danger)를 쓰지 않고 여기서 고정한다 — 웹의 amber-400~orange-500
// 그라데이션 자리이고, RN 에는 그라데이션이 없어 중간 색 하나로 대신한다.
const REWARD_COLOR = "#f59e0b";

function dateOf(month: string, day: number): string {
  return `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

// 강조색의 옅은 배경. 웹의 blue-50 / blue-500-10% 자리다. RN 에는 색 함수가 없어
// 8자리 hex(알파)로 만든다 — 테마별 팔레트를 또 한 벌 두지 않으려는 것.
function tint(colors: Colors): string {
  return `${colors.primary}1f`;
}

function DayCell({
  day,
  stamped,
  reward,
  isToday,
  future,
}: {
  day: number | null;
  stamped: boolean;
  reward: boolean;
  isToday: boolean;
  future: boolean;
}) {
  const colors = useColors();
  // 빈 칸도 자리는 차지해야 요일이 안 어긋난다.
  if (day == null) return <View style={{ flex: 1, aspectRatio: 1 }} />;
  return (
    <View
      style={{
        flex: 1,
        aspectRatio: 1,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 9,
        backgroundColor: reward
          ? REWARD_COLOR
          : stamped
            ? colors.primary
            : future
              ? "transparent"
              : colors.card,
        // 오늘은 테두리로만 표시한다. 도장과 색으로 겨루면 둘 다 안 읽힌다.
        //
        // 도장이 찍힌 날이 오늘이면 테두리를 강조색으로 두면 배경과 같은 색이라 아예
        // 안 보인다(웹은 ring-offset 으로 바깥에 그리지만 RN 의 테두리는 안쪽이다).
        // 그때는 글자색과 같은 흰 테두리로 안쪽에 선을 그린다.
        borderWidth: isToday ? 2 : 0,
        borderColor: stamped ? colors.primaryText : colors.primary,
      }}
    >
      <Text
        style={{
          fontSize: stamped ? 13 : 12,
          fontWeight: stamped ? "700" : "400",
          color: stamped
            ? colors.primaryText
            : future
              ? colors.textMuted
              : colors.text,
          opacity: future ? 0.45 : 1,
        }}
      >
        {reward ? "🎁" : stamped ? "✓" : day}
      </Text>
    </View>
  );
}

// 카드에서 유일하게 행동을 부르는 줄. 위쪽이 "지금까지"라면 여기는 "다음에 뭘 하면
// 되나"다. 출석 전이면 오늘 할 일을, 출석했으면 다음 단계까지 남은 날을 말한다.
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
  const colors = useColors();
  const box = {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  } as const;

  // 오늘 단계를 채웠다면 그 말이 제일 위다. "오늘 출석 완료" 와 같은 색으로 두면
  // 여느 날과 구별되지 않는다 — 한 달에 다섯 번뿐인 순간이라 색을 바꾼다.
  if (todayMilestone) {
    return (
      <View
        style={{
          ...box,
          backgroundColor: `${REWARD_COLOR}1f`,
          borderWidth: 1,
          borderColor: `${REWARD_COLOR}59`,
        }}
      >
        <Text style={{ fontSize: 13, color: colors.text, lineHeight: 19 }}>
          🎉 <Text style={{ fontWeight: "700" }}>축하해요!</Text> 오늘로{" "}
          {todayMilestone.days}일 출석을 채워{" "}
          <Text style={{ fontWeight: "700" }}>멤버십 +{todayMilestone.grantDays}일</Text>을
          받았어요.
          {daysToNext !== null && nextDays !== null && nextGrant !== null
            ? ` 다음은 ${nextDays}일 단계 — ${daysToNext}일 더 오시면 멤버십 ${nextGrant}일이 더 붙어요.`
            : ""}
        </Text>
      </View>
    );
  }

  if (!attendedToday) {
    const left = Math.max(0, ATTENDANCE_MIN_QUESTIONS - todayQuestions);
    return (
      <View style={{ ...box, backgroundColor: colors.card }}>
        <Text style={{ fontSize: 13, color: colors.textMuted, lineHeight: 19 }}>
          오늘{" "}
          <Text style={{ fontWeight: "700", color: colors.text }}>
            {todayQuestions} / {ATTENDANCE_MIN_QUESTIONS}문항
          </Text>
          {" — "}
          {/* 문항 수는 채웠는데 도장이 아직 없는 경계가 있다(최소 문항 기준을 내린
              직후의 지난 기록 등). 그때 "0문항 더 풀면"이 뜨면 말이 안 되므로,
              도장은 attendedDates 를 정본으로 두고 문구만 갈라 준다. */}
          {left > 0
            ? `${left}문항 더 풀면 오늘 출석이에요.`
            : "조금만 더 풀면 오늘 출석으로 반영돼요."}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ ...box, backgroundColor: tint(colors) }}>
      <Text style={{ fontSize: 13, color: colors.text, lineHeight: 19 }}>
        {daysToNext === null || nextDays === null || nextGrant === null ? (
          <>
            오늘 출석 완료! 이번 달 보상을 <Text style={{ fontWeight: "700" }}>전부</Text>{" "}
            받으셨어요.
          </>
        ) : (
          <>
            오늘 출석 완료! <Text style={{ fontWeight: "700" }}>{daysToNext}일</Text> 더
            출석하면 {nextDays}일 단계로 멤버십 {nextGrant}일을 더 받아요.
          </>
        )}
      </Text>
    </View>
  );
}
