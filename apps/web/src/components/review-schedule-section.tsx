"use client";

import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { getReviewSchedule } from "@/app/mypage/wrong-notes/actions";
import type { SessionSchedule } from "@gongmoa/core";
import { ForecastStrip } from "@/components/review-due-card";

// 채점 결과 화면의 "다음 복습" 섹션(멤버십 전용). 방금 푼 문항이 각각 언제 다시
// 나오는지 보여준다 — 틀린 건 내일, 맞힌 건 며칠 뒤로 갈리는 게 여기서 눈에 보인다.
//
// 맞힌 문항이 다시 나온다는 걸 여기서 먼저 알려두지 않으면, 나중에 큐에서 만났을 때
// 버그로 인식한다. "극복"과 "복습 예약"은 다른 개념이라는 걸 이 자리에서 가르친다.
//
// 채점 후에만 의미가 있고 실패해도 결과 화면은 멀쩡해야 하므로, 서버 컴포넌트로
// 끌어올리지 않고 마운트 후 따로 불러온다.
export function ReviewScheduleSection({ sessionId }: { sessionId: string }) {
  const [schedule, setSchedule] = useState<SessionSchedule | null>(null);

  useEffect(() => {
    let alive = true;
    getReviewSchedule({ sessionId })
      .then((res) => {
        if (alive && res.premium && res.schedule) setSchedule(res.schedule);
      })
      .catch(() => {
        // 무시: 스케줄을 못 불러와도 채점 결과는 그대로 보여준다.
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  if (!schedule) return null;

  const scheduled = schedule.items.filter((it) => it.dueInDays != null);
  if (scheduled.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-blue-200 bg-blue-50/70 px-4 py-3.5 dark:border-blue-900/50 dark:bg-blue-950/25">
      <div>
        <p className="flex items-center gap-1.5 text-sm font-bold text-blue-900 dark:text-blue-100">
          <CalendarClock size={16} />
          다음 복습 예약
        </p>
        <p className="text-xs text-blue-700/80 dark:text-blue-300/70">
          맞힌 문제도 간격을 두고 다시 나와요 — 한 번 맞힌 것과 아는 것은 다르니까요
        </p>
      </div>

      <ForecastStrip forecast={schedule.forecast} />

      <ul className="flex flex-col gap-1.5">
        {scheduled.map((it) => (
          <li
            key={it.position}
            className="flex items-center justify-between gap-3 text-xs"
          >
            <span className="min-w-0 truncate text-blue-800/80 dark:text-blue-200/70">
              {it.paperTitle
                ? `${it.paperTitle} ${it.questionNumber}번`
                : `${it.position + 1}번 문항`}
            </span>
            <span className="shrink-0 font-bold tabular-nums text-blue-900 dark:text-blue-100">
              {it.dueInDays === 0
                ? "오늘 다시"
                : it.dueInDays === 1
                  ? "내일"
                  : `${it.dueInDays}일 뒤`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
