import { useCallback, useEffect, useState } from "react";

// 시작 상태기계(웹 cbt-solver.tsx useCbtTimer, 설계서 §4.5 #22): 진입 → 5초 카운트다운
// ("N초 후 시작") → 0 이 되면 cbt-start → 응답 startedAt 을 받은 뒤에야 타이머 시작
// ("시작하는 중..." → formatDuration(elapsed)). 실패하면 red 링크 "시작 기록 실패, 다시 시도".
// 진입 즉시 재거나 클라이언트 시계로 재지 않는다 — 채점의 최소 응시시간 검증은 서버가 기록한
// 시각으로만 하므로 응답을 기다리지 않으면 네트워크 지연만큼 화면보다 늦게 끝난다.
// 드래프트 복원(§6.5)은 resume(startedAt) 으로 카운트다운을 건너뛴다.
export const CBT_COUNTDOWN_SECONDS = 5;

export type CbtTimerPhase = "idle" | "countdown" | "starting" | "start-error" | "running";

export function useCbtTimer({
  enabled,
  running,
  start,
}: {
  // 데이터·드래프트 확인이 끝나기 전에는 카운트다운을 돌리지 않는다.
  enabled: boolean;
  // 채점이 끝나면(false) 시간도 멈춘다.
  running: boolean;
  // cbt-start 호출. 응답의 startedAt(ISO)만이 기준시각.
  start: () => Promise<{ startedAt: string }>;
}) {
  const [countdown, setCountdown] = useState(CBT_COUNTDOWN_SECONDS);
  // 서버 startedAt(ms). null 이면 아직 시작 전.
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [startedAtIso, setStartedAtIso] = useState<string | null>(null);
  const [requested, setRequested] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  const requestStart = useCallback(() => {
    setRequested(true);
    setStartError(null);
    start()
      .then(({ startedAt }) => {
        const ms = new Date(startedAt).getTime();
        setStartedAtIso(startedAt);
        setStartedAtMs(Number.isFinite(ms) ? ms : Date.now());
      })
      .catch((e: unknown) => {
        setRequested(false);
        setStartError(e instanceof Error && e.message ? e.message : "시작 기록에 실패했어요.");
      });
  }, [start]);

  // 카운트다운. 1초마다 하나씩 줄이고, 0 에 닿는 그 틱에서 한 번만 시작 요청을 보낸다
  // (효과 본문이 아니라 타이머 콜백에서 — 렌더 연쇄 없이). 재시도는 이벤트 핸들러(requestStart).
  useEffect(() => {
    if (!enabled || startedAtMs !== null || countdown <= 0) return;
    const t = setTimeout(() => {
      setCountdown((c) => c - 1);
      if (countdown - 1 <= 0 && !requested && !startError) requestStart();
    }, 1000);
    return () => clearTimeout(t);
  }, [enabled, countdown, requested, startError, startedAtMs, requestStart]);

  // 경과시간 — 서버 startedAt 기준.
  useEffect(() => {
    if (!running || startedAtMs === null) return;
    const tick = () => setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtMs) / 1000)));
    const t = setInterval(tick, 1000);
    // 첫 표시도 1초 뒤가 아니라 지금(복원 재개 시 "0분 0초"가 잠깐 보이지 않게).
    const first = setTimeout(tick, 0);
    return () => {
      clearInterval(t);
      clearTimeout(first);
    };
  }, [running, startedAtMs]);

  // "다시 풀기": 카운트다운 5초부터 다시 → 새 cbt-start.
  const reset = useCallback(() => {
    setCountdown(CBT_COUNTDOWN_SECONDS);
    setStartedAtMs(null);
    setStartedAtIso(null);
    setRequested(false);
    setStartError(null);
    setElapsedSeconds(0);
  }, []);

  // 드래프트 복원: 서버 startedAt 으로 즉시 재개(카운트다운 생략).
  const resume = useCallback((startedAt: string) => {
    const ms = new Date(startedAt).getTime();
    if (!Number.isFinite(ms)) return;
    setCountdown(0);
    setRequested(true);
    setStartError(null);
    setStartedAtIso(startedAt);
    setStartedAtMs(ms);
  }, []);

  const started = startedAtMs !== null;
  const phase: CbtTimerPhase = !enabled
    ? "idle"
    : started
      ? "running"
      : countdown > 0
        ? "countdown"
        : startError
          ? "start-error"
          : "starting";

  return {
    phase,
    countdown,
    elapsedSeconds,
    started,
    startError,
    startedAtMs,
    startedAtIso,
    requestStart,
    reset,
    resume,
  };
}
