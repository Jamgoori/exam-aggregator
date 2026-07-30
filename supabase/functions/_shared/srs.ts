// packages/core/src/srs.ts 포팅. 정본은 core 쪽이고 테스트도 거기 있다
// (packages/core/src/srs.test.ts). 엣지 함수는 워크스페이스 패키지를 번들에 못 넣어
// 같은 규칙을 여기에 한 벌 더 둔다 — 한쪽만 고치면 웹과 앱의 복습일이 조용히
// 어긋나므로, 간격·ease 상수를 바꿀 때는 반드시 양쪽을 함께 고칠 것.

export type SrsState = {
  intervalDays: number;
  ease: number;
  reps: number;
  lapses: number;
};

export const SRS_INITIAL: SrsState = {
  intervalDays: 0,
  ease: 2.5,
  reps: 0,
  lapses: 0,
};

export const SRS_MIN_EASE = 1.3;
export const SRS_MAX_EASE = 2.8;
export const SRS_EASE_PENALTY = 0.2;
export const SRS_EASE_BONUS = 0.1;
export const SRS_MAX_INTERVAL_DAYS = 180;
export const SRS_FIRST_INTERVAL_DAYS = 1;
export const SRS_SECOND_INTERVAL_DAYS = 3;
export const SRS_RELEARN_DELAY_HOURS = 3;
export const SRS_LEECH_THRESHOLD = 8;
export const SRS_LEECH_REPEAT = SRS_LEECH_THRESHOLD / 2;

// leech(상습범) 판정 — 기준을 넘은 "그 순간"에만 true. 근거는 core 쪽 주석 참고.
export function isLeechTrigger(lapses: number): boolean {
  if (lapses < SRS_LEECH_THRESHOLD) return false;
  return (lapses - SRS_LEECH_THRESHOLD) % SRS_LEECH_REPEAT === 0;
}

// 하루 경계는 KST 04:00 (자정으로 하면 새벽에 푼 사람의 "내일"이 두 시간 뒤가 된다).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_CUTOFF_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function srsDayIndex(at: Date): number {
  return Math.floor((at.getTime() + KST_OFFSET_MS - DAY_CUTOFF_MS) / DAY_MS);
}

export function srsDayStart(dayIndex: number): Date {
  return new Date(dayIndex * DAY_MS + DAY_CUTOFF_MS - KST_OFFSET_MS);
}

export function srsDueAt(now: Date, intervalDays: number): Date {
  return srsDayStart(srsDayIndex(now) + intervalDays);
}

function clampEase(ease: number): number {
  return Math.min(SRS_MAX_EASE, Math.max(SRS_MIN_EASE, ease));
}

function isFirstEntry(prev: SrsState): boolean {
  return prev.reps === 0 && prev.lapses === 0 && prev.intervalDays === 0;
}

export type SrsResult = { state: SrsState; dueAt: Date; leech?: boolean };

export function isSameSrsDay(a: Date, b: Date): boolean {
  return srsDayIndex(a) === srsDayIndex(b);
}

// 재확인(그날 안에 다시 만나기) 예약 시각. 하루 단위로 접지 않는 유일한 자리.
export function srsRelearnDueAt(now: Date): Date {
  return new Date(now.getTime() + SRS_RELEARN_DELAY_HOURS * 60 * 60 * 1000);
}

// 찍어서 맞힌 문항 — 점수·극복 판정은 그대로 두고 스케줄만 붙잡는다.
export function srsGuessed(prev: SrsState, now: Date): SrsResult {
  return { state: prev, dueAt: srsRelearnDueAt(now) };
}

// lastGradedAt 을 주면 "하루 1회만 반영" 규칙이 걸린다(같은 날 다시 맞혀도 간격을
// 벌리지 않음). 틀린 것은 언제나 반영. 근거는 core 쪽 주석 참고.
export function nextSrs(
  prev: SrsState,
  isCorrect: boolean,
  now: Date,
  lastGradedAt?: Date | null,
): SrsResult {
  // reps 0(재확인 중)은 붙잡지 않는다 — 그날 안에 다시 만나는 장치가 죽는다.
  if (
    isCorrect && lastGradedAt && prev.reps >= 1 && prev.intervalDays >= 1 &&
    isSameSrsDay(lastGradedAt, now)
  ) {
    return { state: prev, dueAt: srsDueAt(lastGradedAt, prev.intervalDays) };
  }

  if (!isCorrect) {
    const first = isFirstEntry(prev);
    const lapses = first ? 0 : prev.lapses + 1;
    return {
      state: {
        intervalDays: SRS_FIRST_INTERVAL_DAYS,
        ease: first ? prev.ease : clampEase(prev.ease - SRS_EASE_PENALTY),
        reps: 0,
        lapses,
      },
      // 내일이 아니라 몇 시간 뒤(재확인 단계).
      dueAt: srsRelearnDueAt(now),
      leech: isLeechTrigger(lapses),
    };
  }

  const reps = prev.reps + 1;
  const intervalDays = reps === 1
    ? SRS_FIRST_INTERVAL_DAYS
    : reps === 2
    ? SRS_SECOND_INTERVAL_DAYS
    : Math.min(
      SRS_MAX_INTERVAL_DAYS,
      Math.max(1, Math.round(prev.intervalDays * prev.ease)),
    );

  return {
    state: {
      intervalDays,
      ease: clampEase(prev.ease + SRS_EASE_BONUS),
      reps,
      lapses: prev.lapses,
    },
    dueAt: srsDueAt(now, intervalDays),
  };
}

export function srsStateFromRow(row: {
  srs_interval_days?: number | null;
  srs_ease?: number | null;
  srs_reps?: number | null;
  srs_lapses?: number | null;
}): SrsState {
  return {
    intervalDays: row.srs_interval_days ?? SRS_INITIAL.intervalDays,
    ease: row.srs_ease ?? SRS_INITIAL.ease,
    reps: row.srs_reps ?? SRS_INITIAL.reps,
    lapses: row.srs_lapses ?? SRS_INITIAL.lapses,
  };
}
