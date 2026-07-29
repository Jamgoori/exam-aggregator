"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, ChevronDown, Lock } from "lucide-react";
import {
  createDueReviewSession,
  toggleReviewSubjectPaused,
} from "@/app/mypage/wrong-notes/actions";
import type { DueForecastDay } from "@gongmoa/core";

// 오답노트 탭의 "오늘의 복습" 카드(멤버십 전용). 홈에는 두지 않는다 — 홈은 매번
// 보는 자리라, 잠긴 카드가 거기 있으면 결제 안 한 사용자가 오답노트 자체를 피하게
// 된다. 여기는 사용자가 "복습하러" 들어온 맥락이므로 제안이 자연스럽다.
//
// 무료 상태에서 밀린 문항 수 같은 숫자는 보여주지 않는다. 못 누르는 숫자는 설득이
// 아니라 압박이고, 2주 체험을 이미 써본 사람에게는 낚시로 읽힌다.

export type ReviewSubjectChoice = { id: string; name: string; paused: boolean };

export type ReviewDueCardProps = {
  premium: boolean;
  todayCount: number;
  deferredCount: number;
  subjects: { name: string; count: number }[];
  forecast: DueForecastDay[];
  nextDueOffset: number | null;
  // 체험 만료까지 남은 일수(체험이 아니면 null). 3일 이하일 때만 알린다.
  trialDaysLeft: number | null;
  // 복습에 넣을 과목 고르기. 예약이 하나라도 있는 과목만 온다.
  subjectChoices: ReviewSubjectChoice[];
};

const SHELL =
  "flex flex-col gap-3 rounded-2xl border px-4 py-3.5 border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/25";

export function ReviewDueCard({
  premium,
  todayCount,
  deferredCount,
  subjects,
  forecast,
  nextDueOffset,
  trialDaysLeft,
  subjectChoices,
}: ReviewDueCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (!premium) return <LockedCard />;

  function startSession() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createDueReviewSession();
      if (res.error || !res.sessionId) {
        setError(res.error ?? "세션을 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  return (
    <div className={SHELL}>
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-sm font-bold text-blue-900 dark:text-blue-100">
            <CalendarCheck size={16} />
            {todayCount > 0 ? (
              <>
                오늘 복습할{" "}
                <span className="text-blue-600 dark:text-blue-300">{todayCount}문항</span>
              </>
            ) : (
              "오늘 복습할 문항 없어요"
            )}
            <span className="rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white">
              멤버십
            </span>
          </p>
          <p className="text-xs text-blue-700/80 dark:text-blue-300/70">
            {todayCount > 0
              ? subjects.length > 0
                ? subjects.map((s) => `${s.name} ${s.count}`).join(" · ")
                : "복습 예정 문항을 모았어요"
              : // 0인 날을 그냥 비워두면 기능이 멈춘 걸로 오해한다. 쉬어도 되는
                // 날이라는 것 자체가 간격 반복의 값어치다.
                nextDueOffset != null
                ? `다음 복습은 ${nextDueOffset}일 뒤예요`
                : "새로 틀린 문제가 생기면 여기에 예약돼요"}
          </p>
          {deferredCount > 0 && (
            <p className="text-xs text-blue-700/60 dark:text-blue-300/50">
              {deferredCount}문항은 내일 이어서 — 오늘치만 끝내면 돼요
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        {todayCount > 0 && (
          <button
            type="button"
            onClick={startSession}
            disabled={pending}
            className="shrink-0 rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {pending ? "여는 중..." : "복습 시작"}
          </button>
        )}
      </div>

      <ForecastStrip forecast={forecast} />

      <SubjectPicker choices={subjectChoices} />

      {trialDaysLeft != null && trialDaysLeft <= 3 && (
        <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
          체험 {trialDaysLeft}일 남음 · 끝나면 예약된 복습이 사라져요
        </p>
      )}
    </div>
  );
}

// 복습에 넣을 과목 고르기. 접힌 한 줄로 두는 이유는 로드맵 UX 원칙 5(설정을 노출하지
// 말고 기본값으로 흡수) 때문이다 — 기본값은 "전체"이고, 한 과목만 파는 시기에만 열어
// 끄면 된다.
//
// 저장은 "끈 과목"으로 한다. 켠 과목 목록으로 저장하면 나중에 새로 공부를 시작한
// 과목이 조용히 빠진 채로 남는다.
function SubjectPicker({ choices }: { choices: ReviewSubjectChoice[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paused, setPaused] = useState<Set<string>>(
    () => new Set(choices.filter((c) => c.paused).map((c) => c.id)),
  );
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();

  // 과목이 하나뿐이면 고를 게 없다 — 줄만 늘어난다.
  if (choices.length < 2) return null;

  const pausedNames = choices.filter((c) => paused.has(c.id)).map((c) => c.name);

  function toggle(id: string) {
    const wasPaused = paused.has(id);
    // 전부 끄면 복습이 통째로 멈춘다. 마지막 하나는 못 끄게 막고 이유를 말해준다.
    if (!wasPaused && paused.size >= choices.length - 1) {
      setError("복습할 과목이 하나는 남아 있어야 해요.");
      return;
    }
    setError(null);
    setPaused((prev) => {
      const next = new Set(prev);
      if (wasPaused) next.delete(id);
      else next.add(id);
      return next;
    });
    start(async () => {
      const res = await toggleReviewSubjectPaused({ subjectId: id, paused: !wasPaused });
      if (res.error) {
        setError(res.error);
        setPaused((prev) => {
          const next = new Set(prev);
          if (wasPaused) next.add(id);
          else next.delete(id);
          return next;
        });
        return;
      }
      // 오늘 문항 수·예보가 즉시 달라지므로 카드를 다시 그린다.
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-2 border-t border-blue-200/60 pt-2 dark:border-blue-900/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 self-start text-xs font-medium text-blue-700/80 hover:text-blue-800 dark:text-blue-300/70 dark:hover:text-blue-200"
      >
        <ChevronDown
          size={13}
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        />
        복습 과목
        <span className="font-normal">
          {pausedNames.length === 0
            ? "전체"
            : `${choices.length - pausedNames.length}/${choices.length} · ${pausedNames.join("·")} 쉬는 중`}
        </span>
      </button>

      {open && (
        <>
          <div className="flex flex-wrap gap-1.5">
            {choices.map((c) => {
              const on = !paused.has(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggle(c.id)}
                  aria-pressed={on}
                  className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                    on
                      ? "bg-blue-600 text-white"
                      : "border border-blue-200 text-blue-700/50 line-through dark:border-blue-900/60 dark:text-blue-300/40"
                  }`}
                >
                  {c.name}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-blue-700/60 dark:text-blue-300/50">
            끈 과목은 복습에 안 나와요. 진도는 지워지지 않고, 다시 켜면 밀린 문항을
            며칠에 나눠서 돌려줘요.
          </p>
        </>
      )}
      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// 요일 7칸 + 숫자만. 막대 그래프를 쓰지 않는 건 좁은 화면에서 안 깨지고 한눈에
// 읽히기 때문이다. 0인 날("-")이 보이는 것 자체가 스케줄이 돌고 있다는 증거라
// 칸을 지우지 않는다.
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function ForecastStrip({ forecast }: { forecast: DueForecastDay[] }) {
  if (forecast.length === 0) return null;
  const today = new Date();

  return (
    <div className="flex overflow-x-auto">
      {forecast.map((d) => {
        const date = new Date(today.getTime() + d.offset * 24 * 60 * 60 * 1000);
        const label =
          d.offset === 0 ? "오늘" : d.offset === 1 ? "내일" : WEEKDAYS[date.getDay()];
        return (
          <div
            key={d.offset}
            className="flex min-w-[2.75rem] flex-1 flex-col items-center gap-0.5 py-1"
          >
            <span className="text-[11px] text-blue-700/60 dark:text-blue-300/50">{label}</span>
            <span
              className={`text-sm tabular-nums ${
                d.count > 0
                  ? "font-bold text-blue-900 dark:text-blue-100"
                  : "text-blue-400/60 dark:text-blue-500/40"
              }`}
            >
              {d.count > 0 ? d.count : "-"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function LockedCard() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 px-4 py-3.5 dark:border-zinc-700 dark:bg-zinc-800/50">
      <Lock size={16} className="shrink-0 text-zinc-400 dark:text-zinc-500" />
      <div className="min-w-0">
        <p className="text-sm font-bold text-zinc-700 dark:text-zinc-300">오늘의 복습</p>
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          틀린 문제를 언제 다시 볼지 문항마다 계산해서 그날 것만 보여줘요 · 멤버십
        </p>
      </div>
    </div>
  );
}
