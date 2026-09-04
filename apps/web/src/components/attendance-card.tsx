import Link from "next/link";
import { CalendarCheck, Check, Gift, PartyPopper, Sparkles } from "lucide-react";
import {
  ATTENDANCE_MILESTONES,
  ATTENDANCE_MIN_QUESTIONS,
  ATTENDANCE_MONTHLY_MAX_DAYS,
  attendanceMilestoneDates,
  attendanceProgress,
  daysInMonthKey,
  type AttendanceMilestone,
} from "@gongmoa/core";

// 마이페이지 월간 출석 카드.
//
// 화면이 규칙을 다시 적지 않는다 — 단계·최소 문항 수·월 최대 일수는 전부
// @gongmoa/core 의 attendance.ts 에서 온다. 여기에 "7일"이나 "5일"을 직접 쓰면
// 단계를 손볼 때 안내 문구만 옛 값으로 남아, 실제 지급과 다른 걸 광고하게 된다.
//
// 무료·유료를 가르지 않고 모두에게 보여준다. 유료 회원에게도 값이 있다 — 받은
// 일수가 만료일 뒤에 이어 붙으므로 구독이 그만큼 늦게 끝난다. 못 누르는 걸 띄우는
// "잠긴 카드"가 아니라서 무료 사용자에게도 압박이 아니다.

export type AttendanceCardProps = {
  // "YYYY-MM-01" (KST).
  month: string;
  // "YYYY-MM-DD" (KST).
  today: string;
  attendedDates: string[];
  todayQuestions: number;
  grantedMilestones: number[];
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function AttendanceCard({
  month,
  today,
  attendedDates,
  todayQuestions,
  grantedMilestones,
}: AttendanceCardProps) {
  const attended = new Set(attendedDates);
  const granted = new Set(grantedMilestones);
  const progress = attendanceProgress(attended.size);
  const attendedToday = attended.has(today);
  // 어느 칸에 축하를 그릴지 — 단계를 채운 그 날의 칸이다. 계산은 core 에 있다
  // (attendanceMilestoneDates): 앱 달력과 같은 칸에 같은 표시가 떠야 한다.
  const milestoneDates = attendanceMilestoneDates(attendedDates);
  const todayMilestone = milestoneDates.get(today) ?? null;

  const monthLabel = Number(month.slice(5, 7));
  const lastDay = daysInMonthKey(month);
  const todayDay = today.startsWith(month.slice(0, 8)) ? Number(today.slice(8, 10)) : 0;
  // 그 달 1일의 요일(0=일). UTC 로 계산해 서버 시간대의 영향을 받지 않는다 —
  // month 자체가 이미 KST 로 정해진 값이라 여기서 또 시간대를 태우면 어긋난다.
  const firstWeekday = new Date(`${month}T00:00:00Z`).getUTCDay();

  return (
    <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      {/* 머리: 이 달에 몇 일을 벌었나. 카드에서 제일 먼저 읽혀야 하는 숫자다. */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-100 bg-gradient-to-br from-blue-50 to-white px-5 py-4 dark:border-zinc-800 dark:from-blue-950/40 dark:to-zinc-900">
        <div className="flex items-center gap-2">
          <CalendarCheck size={18} className="text-blue-600 dark:text-blue-400" />
          <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {monthLabel}월 출석
          </h2>
          <span className="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
            {attended.size}일
          </span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">멤버십</span>
          <span className="text-2xl font-bold leading-none text-blue-600 dark:text-blue-400">
            {progress.earnedDays}
          </span>
          <span className="text-sm font-medium text-zinc-400 dark:text-zinc-500">
            / {ATTENDANCE_MONTHLY_MAX_DAYS}일
          </span>
        </div>
      </header>

      <div className="flex flex-col gap-5 px-5 py-5">
        {/* 단계 막대. 칸 하나가 단계 하나를 맡고, 그 칸 안에서만 채워진다 —
            막대 하나를 통으로 채우면 "지금 몇 번째 단계인지"가 안 읽힌다. */}
        <div className="flex flex-col gap-2">
          <div className="flex gap-1">
            {ATTENDANCE_MILESTONES.map((m, i) => {
              const from = i === 0 ? 0 : ATTENDANCE_MILESTONES[i - 1].days;
              const ratio = Math.max(0, Math.min(1, (attended.size - from) / (m.days - from)));
              return (
                <div
                  key={m.days}
                  className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800"
                >
                  <div
                    className="h-full rounded-full bg-blue-500 transition-[width] dark:bg-blue-400"
                    style={{ width: `${ratio * 100}%` }}
                  />
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-5 gap-1">
            {ATTENDANCE_MILESTONES.map((m) => {
              const done = attended.size >= m.days;
              return (
                <div
                  key={m.days}
                  className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 ${
                    done
                      ? "bg-blue-50 dark:bg-blue-500/10"
                      : "bg-zinc-50 dark:bg-zinc-800/50"
                  }`}
                >
                  <span
                    className={`text-xs font-medium ${
                      done
                        ? "text-blue-700 dark:text-blue-300"
                        : "text-zinc-400 dark:text-zinc-500"
                    }`}
                  >
                    {m.days}일
                  </span>
                  {/* "+1일"이 아니라 "멤버십 +1일"이라고 적는다. 무엇이 늘어나는지를
                      쓰지 않으면 포인트·문제 수 같은 다른 걸로 읽힌다 — 이 기능이 파는
                      건 멤버십 기간이므로 그 단어가 칸마다 보여야 한다.
                      단계가 다섯이라 좁은 화면에선 한 줄에 안 들어간다. flex-wrap 으로
                      "멤버십 / +1일" 두 줄로 접히게 두고, 넓으면 한 줄로 붙는다. */}
                  <span
                    className={`flex flex-wrap items-center justify-center gap-x-0.5 text-center text-[10.5px] leading-tight font-semibold ${
                      done
                        ? "text-blue-600 dark:text-blue-400"
                        : "text-zinc-300 dark:text-zinc-600"
                    }`}
                  >
                    {/* 지급 완료 표시는 원장(granted)에 실제로 남은 것만 붙인다.
                        단계에 닿았는데 지급이 아직이면(재시도 대기) 체크를 안 띄운다 —
                        받지도 않은 걸 받았다고 하면 문의가 온다. */}
                    {granted.has(m.days) && (
                      <Check size={10} strokeWidth={3} className="shrink-0" />
                    )}
                    <span>멤버십</span>
                    <span>+{m.grantDays}일</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* 달력. 도장을 눈으로 세게 한다 — 숫자만 있으면 "내가 언제 빠졌지"가 안 보인다. */}
        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-7 gap-1">
            {WEEKDAYS.map((w, i) => (
              <span
                key={w}
                className={`text-center text-[11px] font-medium ${
                  i === 0
                    ? "text-red-400 dark:text-red-400/70"
                    : "text-zinc-400 dark:text-zinc-500"
                }`}
              >
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {/* 1일이 무슨 요일인지 맞추는 빈 칸. */}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`pad-${i}`} />
            ))}
            {Array.from({ length: lastDay }, (_, i) => {
              const day = i + 1;
              const date = `${month.slice(0, 8)}${String(day).padStart(2, "0")}`;
              const stamped = attended.has(date);
              const isToday = day === todayDay;
              const future = todayDay > 0 && day > todayDay;
              // 단계를 채운 날. 도장(파랑) 대신 선물색으로 칠해 달력만 훑어도
              // "여기서 받았다"가 보이게 한다 — 보상이 단계 막대 안에서만 일어나면
              // 달력은 출석부일 뿐이고, 며칠을 더 와야 하는지가 실감나지 않는다.
              const reward = milestoneDates.get(date) ?? null;
              return (
                <span
                  key={date}
                  title={
                    reward
                      ? `${reward.days}일 달성 — 멤버십 +${reward.grantDays}일`
                      : undefined
                  }
                  className={[
                    "flex aspect-square items-center justify-center rounded-lg text-xs tabular-nums",
                    reward
                      ? "bg-gradient-to-br from-amber-400 to-orange-500 font-semibold text-white shadow-sm shadow-amber-500/30"
                      : stamped
                        ? "bg-blue-500 font-semibold text-white dark:bg-blue-500"
                        : future
                          ? "text-zinc-300 dark:text-zinc-700"
                          : "bg-zinc-50 text-zinc-400 dark:bg-zinc-800/60 dark:text-zinc-500",
                    // 오늘은 테두리로만 표시한다. 도장과 색으로 겨루면 둘 다 안 읽힌다.
                    isToday && !stamped
                      ? "ring-2 ring-blue-400 dark:ring-blue-500"
                      : isToday
                        ? "ring-2 ring-blue-300 ring-offset-1 dark:ring-blue-300/60 dark:ring-offset-zinc-900"
                        : "",
                  ].join(" ")}
                >
                  {reward ? (
                    <Gift size={13} strokeWidth={2.5} />
                  ) : stamped ? (
                    <Check size={13} strokeWidth={3} />
                  ) : (
                    day
                  )}
                </span>
              );
            })}
          </div>

          {/* 달력에 처음 보는 색이 생겼으니 한 줄로 뜻을 붙인다. 받은 날이 하나도
              없으면 아무 말도 하지 않는다 — 빈 범례는 화면만 길게 만든다. */}
          {milestoneDates.size > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
              <span className="flex h-4 w-4 items-center justify-center rounded bg-gradient-to-br from-amber-400 to-orange-500 text-white">
                <Gift size={10} strokeWidth={2.5} />
              </span>
              멤버십을 받은 날이에요
            </p>
          )}
        </div>

        <TodayLine
          attendedToday={attendedToday}
          todayQuestions={todayQuestions}
          todayMilestone={todayMilestone}
          daysToNext={progress.daysToNext}
          nextDays={progress.next?.days ?? null}
          nextGrant={progress.next?.grantDays ?? null}
        />
      </div>
    </section>
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
  // 오늘 단계를 채웠다면 그 말이 제일 위다. "오늘 출석 완료" 와 같은 파란 판으로
  // 두면 여느 날과 구별되지 않는다 — 한 달에 다섯 번뿐인 순간이라 색을 바꾼다.
  if (todayMilestone) {
    return (
      <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 px-4 py-3 dark:border-amber-500/30 dark:from-amber-500/10 dark:to-orange-500/10">
        <PartyPopper
          size={17}
          className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400"
        />
        <p className="break-keep text-sm text-zinc-700 dark:text-zinc-200">
          <b className="font-bold text-amber-700 dark:text-amber-300">축하해요!</b> 오늘로{" "}
          {todayMilestone.days}일 출석을 채워{" "}
          <b className="font-semibold">멤버십 +{todayMilestone.grantDays}일</b>을 받았어요.
          {daysToNext !== null && nextDays !== null && nextGrant !== null && (
            <>
              {" "}
              다음은 {nextDays}일 단계 — {daysToNext}일 더 오시면 멤버십 {nextGrant}일이
              더 붙어요.
            </>
          )}
        </p>
      </div>
    );
  }

  if (!attendedToday) {
    const left = Math.max(0, ATTENDANCE_MIN_QUESTIONS - todayQuestions);
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/60">
        <p className="break-keep text-sm text-zinc-600 dark:text-zinc-300">
          오늘{" "}
          <b className="font-semibold text-zinc-900 dark:text-zinc-100">
            {todayQuestions} / {ATTENDANCE_MIN_QUESTIONS}문항
          </b>
          {" — "}
          {/* 문항 수는 채웠는데 도장이 아직 없는 경계가 있다(최소 문항 기준을 내린
              직후의 지난 기록 등). 그때 "0문항 더 풀면"이 뜨면 말이 안 되므로,
              도장은 attendedDates 를 정본으로 두고 문구만 갈라 준다. */}
          {left > 0
            ? `${left}문항 더 풀면 오늘 출석이에요.`
            : "조금만 더 풀면 오늘 출석으로 반영돼요."}
        </p>
        <Link
          href="/papers"
          className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-400"
        >
          문제 풀러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 dark:bg-blue-500/10">
      <Sparkles size={16} className="shrink-0 text-blue-600 dark:text-blue-400" />
      <p className="break-keep text-sm text-zinc-700 dark:text-zinc-200">
        {daysToNext === null || nextDays === null || nextGrant === null ? (
          <>
            오늘 출석 완료! 이번 달 보상을 <b className="font-semibold">전부</b> 받으셨어요.
          </>
        ) : (
          <>
            오늘 출석 완료! <b className="font-semibold">{daysToNext}일</b> 더 출석하면{" "}
            {nextDays}일 단계로 멤버십 {nextGrant}일을 더 받아요.
          </>
        )}
      </p>
    </div>
  );
}
