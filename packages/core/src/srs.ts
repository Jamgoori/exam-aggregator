// 간격 반복(SRS) 스케줄 — 웹·모바일 공유(순수 계산).
//
// 오답노트의 "섞어풀기"는 미극복 오답을 무작위로 뽑는다(우선순위 없음). 복습은 그와
// 달리 문항마다 "언제 다시 볼지"를 계산해 두고 그날이 된 것만 낸다. SM-2를 객관식
// 채점(맞다/틀리다 2단계)에 맞게 줄인 형태다 — Anki식 4단계 자기평가 버튼은 두지
// 않는다. CBT는 정오답이 자동으로 나오므로 사용자에게 등급을 또 묻는 건 이중 입력이다.
//
// 여기는 계산만 한다. 저장은 user_question_status의 srs_* 컬럼이고, 그 쓰기는 서버
// 채점 경로(recordQuestionResults)만 한다 — 클라이언트가 자기 복습일을 미루거나
// 앞당길 수 없어야 하기 때문이다.

export type SrsState = {
  // 마지막으로 배정된 간격(일). 다음 간격을 이 값에 ease를 곱해 늘린다.
  intervalDays: number;
  // 난이도 계수(SM-2의 EF). 맞히면 오르고 틀리면 내려간다. 큰 값 = 더 빨리 벌어짐.
  ease: number;
  // 연속 정답 횟수. 틀리면 0으로 리셋된다.
  reps: number;
  // 한 번 맞힌 뒤 다시 틀린 횟수. 반복해서 무너지는 문항을 큐 앞으로 당길 때 쓴다.
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

// 간격 상한. 공시는 시험일이 정해져 있어 무한정 벌리는 게 의미가 없고, 반년 뒤로
// 밀린 문항은 사실상 큐에서 사라진 것과 같아진다.
export const SRS_MAX_INTERVAL_DAYS = 180;

// 초반 두 번은 ease를 곱하지 않고 고정 간격으로 간다(SM-2의 학습 단계). 기출은
// 문항 수가 많아 첫 간격을 짧게 잡아야 2주 안에 "간격이 벌어지는" 흐름이 보인다.
export const SRS_FIRST_INTERVAL_DAYS = 1;
export const SRS_SECOND_INTERVAL_DAYS = 3;

// 하루의 경계를 KST 04:00으로 잡는다. 자정 기준으로 하면 새벽 2시에 푼 사람의
// "내일"이 두 시간 뒤가 돼버린다. 공시생은 새벽까지 푸는 경우가 많아 Anki와 같은
// 방식(새벽 4시 경계)을 쓴다.
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_CUTOFF_MS = 4 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// 어떤 시각이 속한 "복습 하루"의 번호. 04:00 이전은 전날로 친다.
export function srsDayIndex(at: Date): number {
  return Math.floor((at.getTime() + KST_OFFSET_MS - DAY_CUTOFF_MS) / DAY_MS);
}

// 복습 하루 번호 → 그날의 시작(KST 04:00) 시각.
export function srsDayStart(dayIndex: number): Date {
  return new Date(dayIndex * DAY_MS + DAY_CUTOFF_MS - KST_OFFSET_MS);
}

// 지금 푼 문항을 intervalDays 뒤로 예약했을 때의 실제 due 시각.
export function srsDueAt(now: Date, intervalDays: number): Date {
  return srsDayStart(srsDayIndex(now) + intervalDays);
}

function clampEase(ease: number): number {
  return Math.min(SRS_MAX_EASE, Math.max(SRS_MIN_EASE, ease));
}

// 아직 SRS에 한 번도 들어온 적 없는 상태인지(= 이번이 첫 오답). 첫 오답은 "복습하다
// 무너진 것"이 아니므로 ease를 깎지도, lapses를 올리지도 않는다.
function isFirstEntry(prev: SrsState): boolean {
  return prev.reps === 0 && prev.lapses === 0 && prev.intervalDays === 0;
}

export type SrsResult = { state: SrsState; dueAt: Date };

// 같은 "복습 하루" 안에서 이미 채점된 문항인지. 간격을 벌릴지 말지를 가른다.
export function isSameSrsDay(a: Date, b: Date): boolean {
  return srsDayIndex(a) === srsDayIndex(b);
}

// 채점 결과 하나를 스케줄에 반영한다.
//
// 틀리면 간격을 1일로 되돌리고 ease를 깎는다(다음부터 더 촘촘히 나옴).
// 맞히면 1일 → 3일 → 그 뒤로는 직전 간격 × ease 로 벌어진다. 간격 계산에는 갱신 전
// ease를 쓴다 — 이번 정답의 보너스는 다음 회차부터 반영되게 해서 한 번 맞혔다고
// 간격이 두 배로 튀지 않게 한다.
//
// lastGradedAt(직전 채점 시각)을 주면 "하루 1회만 반영" 규칙이 걸린다. 섞어풀기는
// 쿨다운이 없어 같은 문항을 하루에 몇 번이고 다시 풀 수 있는데, 그때마다 reps가
// 올라가면 1일 → 3일 → 8일이 하루 만에 지나간다. 간격을 두고 만나야 유지력이라고
// 부를 수 있으므로, 간격 없이 연달아 맞힌 것은 유지력의 증거로 치지 않는다.
// 틀린 것은 언제나 반영한다 — 방금 맞힌 문항을 곧바로 틀렸다면 그게 진짜 신호다.
export function nextSrs(
  prev: SrsState,
  isCorrect: boolean,
  now: Date,
  lastGradedAt?: Date | null,
): SrsResult {
  // intervalDays가 0이면 아직 예약이 없는 상태(마이그레이션 전 행 등)라 되돌릴
  // 스케줄 자체가 없다 — 그때는 정상 계산으로 보낸다.
  if (isCorrect && lastGradedAt && prev.intervalDays >= 1 && isSameSrsDay(lastGradedAt, now)) {
    // 직전 채점이 오늘이므로 srsDueAt(lastGradedAt, ...)은 그때 잡힌 due를 그대로
    // 재현한다(같은 하루 번호 + 같은 간격). 별도로 due를 들고 다닐 필요가 없다.
    return { state: prev, dueAt: srsDueAt(lastGradedAt, prev.intervalDays) };
  }

  if (!isCorrect) {
    const first = isFirstEntry(prev);
    return {
      state: {
        intervalDays: SRS_FIRST_INTERVAL_DAYS,
        ease: first ? prev.ease : clampEase(prev.ease - SRS_EASE_PENALTY),
        reps: 0,
        lapses: first ? 0 : prev.lapses + 1,
      },
      dueAt: srsDueAt(now, SRS_FIRST_INTERVAL_DAYS),
    };
  }

  const reps = prev.reps + 1;
  const intervalDays =
    reps === 1
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

// DB 행(스네이크 케이스, 마이그레이션 전이면 컬럼 자체가 없을 수 있음)을 SrsState로.
// 값이 비어 있으면 초기 상태로 떨어뜨려, 스키마가 아직 안 올라간 환경에서도 채점이
// 깨지지 않게 한다.
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
