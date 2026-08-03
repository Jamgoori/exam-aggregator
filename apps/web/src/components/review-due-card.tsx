"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarCheck, HelpCircle, Lock, Settings, X } from "lucide-react";
import { ReviewGuideModal } from "@/components/review-guide-modal";
import {
  createDueReviewSession,
  createExtraReviewSession,
  restoreSuspendedReview,
  setReviewDailyLimit,
  spreadReviewBacklog,
  toggleReviewSubjectPaused,
} from "@/app/mypage/wrong-notes/actions";
import { DAILY_LIMIT_OPTIONS, type DueForecastDay } from "@gongmoa/core";

// 밀린 문항이 이만큼 넘으면 "정리하기"를 권한다. 하루 상한의 몇 배쯤 되면 매일
// 풀어도 숫자가 안 줄어드는 것처럼 보여 손을 놓게 된다.
const BACKLOG_NUDGE_MIN = 100;

// 오답노트 탭의 "오늘의 복습" 카드(멤버십 전용). 홈에는 두지 않는다 — 홈은 매번
// 보는 자리라, 잠긴 카드가 거기 있으면 결제 안 한 사용자가 오답노트 자체를 피하게
// 된다. 여기는 사용자가 "복습하러" 들어온 맥락이므로 제안이 자연스럽다.
//
// 무료 상태에서 밀린 문항 수 같은 숫자는 보여주지 않는다. 못 누르는 숫자는 설득이
// 아니라 압박이고, 2주 체험을 이미 써본 사람에게는 낚시로 읽힌다.

export type ReviewSubjectChoice = {
  id: string;
  name: string;
  paused: boolean;
  scheduledCount: number;
  // 아직 승격되지 않고 순서를 기다리는 오답 수.
  pendingCount: number;
};

export type ReviewDueCardProps = {
  premium: boolean;
  todayCount: number;
  deferredCount: number;
  // 오늘 큐에 처음 들어온(대기 풀에서 승격된) 문항 수.
  newCount: number;
  // 아직 순서를 기다리는 오답 수. 승격되지 않은 오답이 사라진 게 아니라는 걸
  // 말해주지 않으면, 1회독 중인 사용자는 오답이 증발했다고 읽는다.
  pendingTotal: number;
  // 지금 due가 지난 문항 전체. 이게 크면 "밀린 복습 정리하기"를 권한다.
  overdueTotal: number;
  // 오늘 안에 한 번 더 나올 문항 수(재확인 대기 중).
  relearnCount: number;
  // 여덟 번 넘게 무너져 접어둔 문항 수.
  suspendedTotal: number;
  // 채점 전에 두고 나온 세션이 있으면 그 id. 버튼이 "이어서 풀기"로 바뀐다.
  resumeSessionId: string | null;
  dailyLimit: number;
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
  newCount,
  pendingTotal,
  overdueTotal,
  relearnCount,
  suspendedTotal,
  resumeSessionId,
  dailyLimit,
  subjects,
  forecast,
  nextDueOffset,
  trialDaysLeft,
  subjectChoices,
}: ReviewDueCardProps) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  // 서버가 준 목록으로 시작하고, 이후에는 화면이 진실이다. 토글은 낙관적으로 즉시
  // 반영하고 실패하면 되돌린다(모달 안에서).
  const [choices, setChoices] = useState<ReviewSubjectChoice[]>(subjectChoices);
  const pausedNames = choices.filter((c) => c.paused).map((c) => c.name);

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

  // 오늘치를 끝냈는데 더 풀고 싶은 사람용. 하루 몫은 유입을 막으려는 장치지 상한을
  // 강제하려는 게 아니라, 스스로 더 하겠다는 걸 막을 이유가 없다.
  function startExtraSession() {
    if (pending) return;
    setError(null);
    start(async () => {
      const res = await createExtraReviewSession();
      if (res.error || !res.sessionId) {
        setError(res.error ?? "세션을 시작하지 못했어요.");
        return;
      }
      router.push(`/mypage/wrong-notes/all/review/${res.sessionId}`);
    });
  }

  return (
    <div className={SHELL}>
      <div className="flex flex-wrap items-start gap-3">
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
            {resumeSessionId
              ? "채점 전에 두고 나온 복습이 있어요 · 고른 답은 그대로예요"
              : todayCount > 0
              ? subjects.length > 0
                ? subjects.map((s) => `${s.name} ${s.count}`).join(" · ")
                : "복습 예정 문항을 모았어요"
              : // 방금 틀린 문항은 몇 시간 뒤 재확인으로 돌아온다. 이걸 안 알리면
                // "없어요"를 보고 닫았다가 세 시간 뒤 숫자가 다시 생긴다.
                relearnCount > 0
                ? `방금 틀린 ${relearnCount}문항이 몇 시간 뒤 한 번 더 나와요`
                : // 0인 날을 그냥 비워두면 기능이 멈춘 걸로 오해한다. 쉬어도 되는
                  // 날이라는 것 자체가 간격 반복의 값어치다.
                  nextDueOffset != null
                  ? `다음 복습은 ${nextDueOffset}일 뒤예요`
                  : "새로 틀린 문제가 생기면 여기에 예약돼요"}
          </p>
          {newCount > 0 && (
            <p className="text-xs text-blue-700/60 dark:text-blue-300/50">
              그중 {newCount}문항은 오늘 처음 복습해요
            </p>
          )}
          {deferredCount > 0 && (
            <p className="text-xs text-blue-700/60 dark:text-blue-300/50">
              {deferredCount}문항은 내일 이어서 — 오늘치만 끝내면 돼요
            </p>
          )}
          {/* 승격 안 된 오답은 사라진 게 아니다. 1회독 중이면 이 숫자가 수백까지
              가는데, 말해주지 않으면 "내 오답 어디 갔냐"가 된다. */}
          {pendingTotal > 0 && (
            <p className="text-xs text-blue-700/60 dark:text-blue-300/50">
              오답 {pendingTotal}문항은 오답노트에서 차례를 기다리는 중이에요
              {todayCount > 0 && newCount === 0
                ? " · 오늘은 밀린 복습이 많아 새 문항은 쉬어요"
                : ""}
            </p>
          )}
          {error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
        {/* 과목 설정은 아이콘 하나로만 둔다 — 매일 누르는 버튼이 아니라서
            "복습 시작"과 같은 무게로 보이면 안 된다. */}
        <div className="flex shrink-0 items-center gap-1.5">
          {todayCount > 0 || resumeSessionId ? (
            <button
              type="button"
              onClick={startSession}
              disabled={pending}
              className="rounded-lg bg-blue-600 px-3.5 py-2 text-sm font-bold text-white transition-colors hover:bg-blue-700 disabled:opacity-60"
            >
              {pending ? "여는 중..." : resumeSessionId ? "이어서 풀기" : "복습 시작"}
            </button>
          ) : (
            // 오늘치를 끝냈고 대기가 남아 있을 때만. 밀린 복습이 남아 있으면
            // collectExtraQueueItems가 거절하므로 버튼 자체를 안 띄운다.
            pendingTotal > 0 && (
              <button
                type="button"
                onClick={startExtraSession}
                disabled={pending}
                className="rounded-lg border border-blue-300 px-3.5 py-2 text-sm font-bold text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-60 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/40"
              >
                {pending ? "여는 중..." : "복습 더하기"}
              </button>
            )
          )}
          {/* 톱니 왼쪽 — 설정보다 먼저 눌러야 할 것이다. 예약이 하나도 없는 첫
              사용자에게 가장 필요하므로 조건 없이 띄운다. */}
          <button
            type="button"
            onClick={() => setGuideOpen(true)}
            aria-label="복습 안내"
            title="복습이 어떻게 돌아가나요?"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-700/60 transition-colors hover:bg-blue-100 hover:text-blue-800 dark:text-blue-300/50 dark:hover:bg-blue-900/40 dark:hover:text-blue-200"
          >
            <HelpCircle size={17} />
          </button>
          {(subjectChoices.length > 0 || todayCount > 0) && (
            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              aria-label="복습 설정"
              title="복습 설정"
              className="flex h-9 w-9 items-center justify-center rounded-lg text-blue-700/70 transition-colors hover:bg-blue-100 hover:text-blue-800 dark:text-blue-300/60 dark:hover:bg-blue-900/40 dark:hover:text-blue-200"
            >
              <Settings size={17} />
            </button>
          )}
        </div>
      </div>

      <ForecastStrip forecast={forecast} />

      {pausedNames.length > 0 && (
        <p className="text-[11px] text-blue-700/60 dark:text-blue-300/50">
          {pausedNames.join(" · ")} 쉬는 중
        </p>
      )}

      {guideOpen && (
        <ReviewGuideModal dailyLimit={dailyLimit} onClose={() => setGuideOpen(false)} />
      )}

      {settingsOpen && (
        <ReviewSettingsModal
          choices={choices}
          onChange={setChoices}
          dailyLimit={dailyLimit}
          overdueTotal={overdueTotal}
          suspendedTotal={suspendedTotal}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {trialDaysLeft != null && trialDaysLeft <= 3 && (
        <p className="text-xs font-medium text-blue-800 dark:text-blue-200">
          체험 {trialDaysLeft}일 남음 · 끝나면 예약된 복습이 사라져요
        </p>
      )}
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

// 복습 설정 모달. 하루 문항 수 → 밀린 복습 정리 → 과목 켜고 끄기 순으로 담는다.
//
// 카드 안 접힌 칩이 아니라 모달인 이유: 과목이 열 개 가까이 되면 칩이 카드를 밀어내
// 매일 보는 "오늘 복습" 숫자가 접힌다. 설정은 가끔 여는 것이고, 그 순간에는 화면을
// 다 써도 된다.
//
// 과목은 "끈 과목"으로 저장한다(review_preferences.paused_subject_ids). 켠 과목
// 목록으로 저장하면 나중에 새로 공부를 시작한 과목이 조용히 빠진 채로 남는다.
function ReviewSettingsModal({
  choices,
  onChange,
  dailyLimit,
  overdueTotal,
  suspendedTotal,
  onClose,
}: {
  choices: ReviewSubjectChoice[];
  onChange: (next: ReviewSubjectChoice[]) => void;
  dailyLimit: number;
  overdueTotal: number;
  suspendedTotal: number;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [limit, setLimit] = useState(dailyLimit);
  const [limitBusy, setLimitBusy] = useState(false);
  const [spreadDone, setSpreadDone] = useState<number | null>(null);
  const [spreadBusy, setSpreadBusy] = useState(false);
  const [restoreDone, setRestoreDone] = useState<number | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [, start] = useTransition();

  // 열려 있는 동안 뒤 화면이 스크롤되지 않게 하고, Esc로 닫는다.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const onCount = choices.filter((c) => !c.paused).length;

  function changeLimit(next: number) {
    if (limitBusy || next === limit) return;
    setError(null);
    setLimitBusy(true);
    const previous = limit;
    setLimit(next);
    start(async () => {
      const res = await setReviewDailyLimit({ limit: next });
      setLimitBusy(false);
      if (res.error) {
        setError(res.error);
        setLimit(previous);
        return;
      }
      router.refresh();
    });
  }

  function spreadBacklog() {
    if (spreadBusy) return;
    setError(null);
    setSpreadBusy(true);
    start(async () => {
      const res = await spreadReviewBacklog();
      setSpreadBusy(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setSpreadDone(res.spreadCount ?? 0);
      router.refresh();
    });
  }

  function restoreSuspended() {
    if (restoreBusy) return;
    setError(null);
    setRestoreBusy(true);
    start(async () => {
      const res = await restoreSuspendedReview();
      setRestoreBusy(false);
      if (res.error) {
        setError(res.error);
        return;
      }
      setRestoreDone(res.restoredCount ?? 0);
      router.refresh();
    });
  }

  function toggle(target: ReviewSubjectChoice) {
    if (busyId) return;
    const nextPaused = !target.paused;
    // 전부 끄면 복습이 통째로 멈춘다. 마지막 하나는 막고 이유를 말해준다.
    if (nextPaused && onCount <= 1) {
      setError("복습할 과목이 하나는 남아 있어야 해요.");
      return;
    }
    setError(null);
    setBusyId(target.id);
    onChange(
      choices.map((c) => (c.id === target.id ? { ...c, paused: nextPaused } : c)),
    );
    start(async () => {
      const res = await toggleReviewSubjectPaused({
        subjectId: target.id,
        paused: nextPaused,
      });
      setBusyId(null);
      if (res.error) {
        setError(res.error);
        onChange(
          choices.map((c) => (c.id === target.id ? { ...c, paused: target.paused } : c)),
        );
        return;
      }
      // 오늘 문항 수·예보가 즉시 달라지므로 카드를 다시 그린다.
      router.refresh();
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="복습 과목 설정"
      onClick={onClose}
      className="animate-modal-fade-in fixed inset-0 z-50 flex items-end justify-center bg-zinc-900/40 backdrop-blur-sm sm:items-center sm:p-4 dark:bg-black/60"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="animate-modal-panel-in flex max-h-[85vh] w-full max-w-md flex-col rounded-t-3xl bg-white shadow-2xl ring-1 ring-zinc-900/5 sm:rounded-2xl dark:bg-zinc-900 dark:ring-white/10"
      >
        {/* 모바일 바텀시트 손잡이 — 아래에서 올라온 판이라는 걸 알려준다. */}
        <div className="flex justify-center pt-2.5 sm:hidden">
          <span className="h-1 w-9 rounded-full bg-zinc-200 dark:bg-zinc-700" />
        </div>

        <div className="flex items-start gap-3 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold">복습 설정</h3>
            <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">
              하루 {limit}문항 · 과목 {onCount}/{choices.length} 켜짐
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-600 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <X size={17} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-1">
          <div className="px-3 pb-3">
            <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              하루에 풀 문항 수
            </p>
            <div className="mt-2 flex gap-1.5">
              {DAILY_LIMIT_OPTIONS.map((n) => {
                const on = n === limit;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => changeLimit(n)}
                    disabled={limitBusy}
                    aria-pressed={on}
                    className={`flex-1 rounded-lg py-2 text-sm font-bold tabular-nums transition-colors disabled:opacity-60 ${
                      on
                        ? "bg-blue-600 text-white"
                        : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
                    }`}
                  >
                    {n}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              밀린 복습을 먼저 채우고, 남는 자리에 처음 보는 오답을 하루{" "}
              {Math.max(1, Math.round(limit / 2))}문항까지 새로 넣어요.
            </p>
          </div>

          {/* 연체가 크게 쌓였을 때만 보인다. 평소에 있으면 "정리해야 하나" 하는
              불안만 준다. */}
          {overdueTotal >= BACKLOG_NUDGE_MIN && (
            <div className="mx-3 mb-3 rounded-xl bg-amber-50 px-3 py-2.5 dark:bg-amber-950/30">
              <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
                밀린 복습 {overdueTotal}문항
              </p>
              {spreadDone == null ? (
                <>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-200/70">
                    앞으로 며칠에 걸쳐 나눠서 다시 예약해요. 문항이 사라지지는 않아요.
                  </p>
                  <button
                    type="button"
                    onClick={spreadBacklog}
                    disabled={spreadBusy}
                    className="mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-amber-700 disabled:opacity-60"
                  >
                    {spreadBusy ? "정리하는 중..." : "밀린 복습 정리하기"}
                  </button>
                </>
              ) : (
                <p className="mt-0.5 text-[11px] leading-relaxed text-amber-800/80 dark:text-amber-200/70">
                  {spreadDone}문항을 며칠에 나눠 다시 예약했어요.
                </p>
              )}
            </div>
          )}

          {/* 여덟 번 넘게 무너져 자동으로 접힌 문항. 조용히 사라지면 사용자는
              데이터가 날아간 걸로 읽으므로 어디 갔는지 여기서 말해준다. */}
          {suspendedTotal > 0 && (
            <div className="mx-3 mb-3 rounded-xl bg-zinc-100 px-3 py-2.5 dark:bg-zinc-800/60">
              <p className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                접어둔 문제 {suspendedTotal}문항
              </p>
              {restoreDone == null ? (
                <>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                    여덟 번 넘게 틀려서 복습에서 잠시 뺐어요. 간격을 좁혀도 안 풀리는
                    문제라, 해설을 먼저 보는 편이 빨라요.
                  </p>
                  <button
                    type="button"
                    onClick={restoreSuspended}
                    disabled={restoreBusy}
                    className="mt-2 rounded-lg bg-zinc-700 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-zinc-800 disabled:opacity-60 dark:bg-zinc-600 dark:hover:bg-zinc-500"
                  >
                    {restoreBusy ? "되살리는 중..." : "다시 복습에 넣기"}
                  </button>
                </>
              ) : (
                <p className="mt-0.5 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {restoreDone}문항을 며칠에 나눠 다시 넣었어요.
                </p>
              )}
            </div>
          )}

          {choices.length > 0 && (
            <p className="px-3 pb-1 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              복습에 넣을 과목
            </p>
          )}
          <div className="flex flex-col">
            {choices.map((c) => {
              const on = !c.paused;
              return (
                <button
                  key={c.id}
                  type="button"
                  role="switch"
                  aria-checked={on}
                  onClick={() => toggle(c)}
                  className="flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-zinc-50 active:bg-zinc-100 dark:hover:bg-zinc-800/60 dark:active:bg-zinc-800"
                >
                  <span className="min-w-0 flex-1">
                    <span
                      className={`block truncate text-sm font-medium transition-colors ${
                        on ? "" : "text-zinc-400 dark:text-zinc-600"
                      }`}
                    >
                      {c.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-zinc-400 dark:text-zinc-600">
                      {on
                        ? [
                            `복습 예약 ${c.scheduledCount}문항`,
                            // 1회독 중이면 예약 0에 대기만 수백인 과목이 흔하다.
                            // 예약만 보여주면 "0문항"으로 떠서 끌 이유가 없어 보인다.
                            c.pendingCount > 0 ? `대기 ${c.pendingCount}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : `쉬는 중 · ${c.scheduledCount + c.pendingCount}문항 보관됨`}
                    </span>
                  </span>
                  <Switch on={on} busy={busyId === c.id} />
                </button>
              );
            })}
          </div>
        </div>

        {error && (
          <p className="px-5 pb-1 text-xs text-red-600 dark:text-red-400">{error}</p>
        )}

        <div className="border-t border-zinc-100 px-5 py-3 dark:border-zinc-800">
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            끈 과목은 복습과 알림에 나오지 않아요. 진도는 지워지지 않고, 다시 켜면 밀린
            문항을 며칠에 나눠서 돌려줘요.
          </p>
        </div>
      </div>
    </div>
  );
}

// on/off 스위치. 저장이 도는 동안에는 살짝 흐려져서 눌린 게 반영 중이라는 걸 알린다.
function Switch({ on, busy }: { on: boolean; busy: boolean }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? "bg-blue-600" : "bg-zinc-200 dark:bg-zinc-700"
      } ${busy ? "opacity-60" : ""}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out ${
          on ? "translate-x-[1.375rem]" : "translate-x-0.5"
        }`}
      />
    </span>
  );
}
