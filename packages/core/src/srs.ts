// 간격 반복(SRS) 스케줄 — 웹·모바일 공유(순수 계산).
//
// 오답노트의 "섞어풀기"는 미극복 오답을 무작위로 뽑는다(우선순위 없음). 복습은 그와
// 달리 문항마다 "언제 다시 볼지"를 계산해 두고 그날이 된 것만 낸다. SM-2를 객관식
// 채점(맞다/틀리다 2단계)에 맞게 줄인 형태다 — Anki식 4단계 자기평가 버튼은 두지
// 않는다. CBT는 정오답이 자동으로 나오므로 사용자에게 등급을 또 묻는 건 이중 입력이다.
//
// 순수 SM-2와 다른 점이 하나 더 있다: 채점이 예정일에만 일어나지 않는다는 걸 전제로
// 한다. Anki는 카드를 봐야 채점이 생기지만 여기는 회독(문제지 통째 재응시)과
// 섞어풀기가 스케줄과 무관하게 같은 문항을 다시 채점한다. 그래서 정답·오답을 그대로
// 받지 않고 "예정일 대비 얼마나 일찍 만났는지 / 배정한 간격 중 얼마나 버텼는지"로
// 한 번 걸러서 반영한다(dueProgress·retainedProgress).
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

// ease 상한을 초기값과 같은 2.5로 둔다 = "정답으로는 기본값보다 후해지지 않는다".
//
// 예전에는 상한이 2.8이고 정답마다 +0.1이라, 세 번만 맞히면 상한에 붙었다. 그건
// SM-2에서 q=5(완벽하게 즉시 기억)일 때의 보정값인데, 우리 채점은 맞다/틀리다
// 2단계라 "겨우 맞힌 것"과 "확실히 아는 것"을 구분할 수 없다. 구분이 안 되면
// 낮은 쪽(Anki의 '보통')으로 잡는 게 맞다 — 4지선다는 몰라도 25%가 맞고, 두
// 개까지 좁혀 찍으면 50%다. 그 정답에 보너스까지 주면 모르는 문항이 "아는 문제"로
// 분류돼 큐에서 빠진다.
//
// 그래도 보너스를 0으로 없애지는 않는다. 무너져서 ease가 깎인 문항이 다시 안정될
// 때 되돌아올 길이 있어야 한다 — 상한이 2.5라 회복 전용으로만 작동한다.
export const SRS_MAX_EASE = 2.5;
export const SRS_EASE_PENALTY = 0.2;
export const SRS_EASE_BONUS = 0.05;

// 간격 상한. 공시는 시험일이 정해져 있어 무한정 벌리는 게 의미가 없고, 반년 뒤로
// 밀린 문항은 사실상 큐에서 사라진 것과 같아진다.
export const SRS_MAX_INTERVAL_DAYS = 180;

// 초반 두 번은 ease를 곱하지 않고 고정 간격으로 간다(SM-2의 학습 단계). 기출은
// 문항 수가 많아 첫 간격을 짧게 잡아야 2주 안에 "간격이 벌어지는" 흐름이 보인다.
export const SRS_FIRST_INTERVAL_DAYS = 1;
export const SRS_SECOND_INTERVAL_DAYS = 3;

// 틀린 문항을 그날 안에 다시 만나기까지의 시간(재확인 단계). 망각 곡선이 가장 급하게
// 떨어지는 구간이 직후 몇 시간이라, 최소 간격이 "내일"이면 그 구간을 통째로 놓친다.
// Anki의 relearning step과 같은 자리다.
export const SRS_RELEARN_DELAY_HOURS = 3;

// leech(상습범) 판정 기준 — Anki 기본값과 같은 8회. 여기까지 무너진 문항은 간격을
// 더 좁혀도 안 풀린다. 우선순위 점수가 lapses에 비례하다 보니 방치하면 이런 문항
// 몇 개가 매일 큐 앞자리를 영구 점유하고, 사용자는 "매일 같은 문제만 나온다"를
// 겪다가 그만둔다. 문제는 간격이 아니라 이해라, 큐에서 빼고 따로 보게 해야 한다.
export const SRS_LEECH_THRESHOLD = 8;

// 한 번 접어둔 뒤 다시 넣었는데 또 무너지면, 이 간격마다 다시 접는다(Anki와 같이
// 기준의 절반). 8 → 12 → 16 ...
export const SRS_LEECH_REPEAT = SRS_LEECH_THRESHOLD / 2;

// 예정일의 이 비율도 안 지나서 틀린 것은 "조기 실패"로 본다(간격 반감, lapse 없음).
//
// 이 서비스에서 채점은 복습 세션에서만 일어나지 않는다. 공시생의 기본 학습 방식은
// 같은 문제지 회독이고, 섞어풀기도 스케줄을 보지 않는다. 그래서 간격 62일짜리
// 문항을 5일 만에 다시 만나 틀리는 일이 정상적으로 벌어지는데, 그걸 예정일에
// 무너진 것과 똑같이 처리하면(간격 1일 리셋 + lapse + leech 진행) 회독을 열심히
// 할수록 복습 스케줄이 망가진다. 5일 만에 못 맞히는 건 당연한 일이라 벌이 아니다.
export const SRS_EARLY_LAPSE_RATIO = 0.5;

// 조기 실패일 때 간격에 곱하는 값. 리셋이 아니라 반감이다 — 정보가 없는 게 아니라
// "생각보다 덜 익었다" 정도의 정보라서.
export const SRS_EARLY_LAPSE_FACTOR = 0.5;

// 이 일수 이상인 간격만 흔든다(fuzz). 1·3일 학습 단계는 흔들면 의미가 사라진다.
export const SRS_FUZZ_MIN_DAYS = 4;

// 흔드는 폭(±비율). Anki와 같은 자리다.
//
// 간격이 결정적이면 하루에 푼 20문항이 영원히 같은 날 함께 움직인다(1 → 3 → 8 →
// 20이 전부 같으므로). 그 결과가 예보표의 "오늘 0, 3일 뒤 40" 같은 요철이고,
// 밀린 복습 정리·보류 해제 재분산 같은 사후 보정이 필요했던 원인 중 하나다.
// 코호트를 조금씩 흩어 두면 애초에 뭉치지 않는다.
export const SRS_FUZZ_RATIO = 0.1;

// 이번 lapse로 leech 판정에 걸렸는지. lapses가 기준을 넘은 "그 순간"에만 true라
// 매번 접히지 않는다.
export function isLeechTrigger(lapses: number): boolean {
  if (lapses < SRS_LEECH_THRESHOLD) return false;
  return (lapses - SRS_LEECH_THRESHOLD) % SRS_LEECH_REPEAT === 0;
}

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

export type SrsResult = {
  state: SrsState;
  dueAt: Date;
  // 이번 채점으로 leech 판정에 걸렸는지. 호출부가 이 문항을 큐에서 접는다.
  leech?: boolean;
};

// 같은 "복습 하루" 안에서 이미 채점된 문항인지. 간격을 벌릴지 말지를 가른다.
export function isSameSrsDay(a: Date, b: Date): boolean {
  return srsDayIndex(a) === srsDayIndex(b);
}

// 재확인 예약 시각. 하루 단위로 반올림하지 않는 유일한 자리다 — "몇 시간 뒤"가
// 핵심이라 srsDayStart로 접으면 의미가 사라진다.
export function srsRelearnDueAt(now: Date): Date {
  return new Date(now.getTime() + SRS_RELEARN_DELAY_HOURS * 60 * 60 * 1000);
}

// 맞히긴 했는데 찍은 문항. 점수·극복 판정은 정답 그대로 두고 스케줄만 붙잡는다.
// 4지선다는 모르고도 25%가 맞는데, 그걸 유지력으로 인정하면 정작 모르는 문항이
// "아는 문제"로 분류돼 큐에서 빠져나간다. 틀린 것으로 치지 않는 이유는 ease를 깎고
// lapses를 올리는 건 과한 처벌이고, 극복 판정까지 뒤집히기 때문이다.
export function srsGuessed(prev: SrsState, now: Date): SrsResult {
  return { state: prev, dueAt: srsRelearnDueAt(now) };
}

// 예정일까지 얼마나 왔는지(0~1). 1이면 예정일이 됐거나 지났다.
//
// "이 오답이 진짜 실패인가"를 가르는 값이다. 예정일이 안 됐는데 만난 문항은
// 회독이나 섞어풀기가 끌어온 것이고, 거기서 틀린 건 스케줄의 실패가 아니다.
// dueAt을 모르면(마이그레이션 전·승격 직후) 1로 본다 — 예전 동작 그대로.
function dueProgress(prev: SrsState, now: Date, dueAt?: Date | null): number {
  if (!dueAt || prev.intervalDays <= 0) return 1;
  const remaining = srsDayIndex(dueAt) - srsDayIndex(now);
  if (remaining <= 0) return 1;
  return Math.max(0, (prev.intervalDays - remaining) / prev.intervalDays);
}

// 배정한 간격 중 실제로 버틴 비율(0~1). 1이면 배정한 만큼을 다 기억했다는 뜻이다.
//
// "이 정답을 얼마나 인정할 것인가"를 가르는 값이다. 62일 뒤에 보라고 배정해 둔
// 문항을 5일 만에 회독에서 맞혔다면 그건 5일치 기억이지 62일치 기억이 아니다.
// 예전에는 이걸 안 봐서 간격이 62 → 174로 뛰었다.
function retainedProgress(
  prev: SrsState,
  now: Date,
  lastGradedAt?: Date | null,
): number {
  if (!lastGradedAt || prev.intervalDays <= 0) return 1;
  const elapsed = srsDayIndex(now) - srsDayIndex(lastGradedAt);
  return Math.max(0, Math.min(1, elapsed / prev.intervalDays));
}

// 실제로 버틴 일수가 뒷받침하지 못하는 간격은 배정하지 않는다.
//
// retainedProgress가 회차마다 성장을 깎아도 "예정일 전 정답"이 반복되면 그 성장이
// 복리로 쌓인다. 간격 60일 문항을 매일 회독으로 맞히면 회차마다 1.025배씩 붙어
// 20일이면 60 → 98이 되고, due는 늘 "오늘 + 간격"이라 그만큼 미래로 밀린다.
// 회독을 성실히 할수록 복습 큐가 비는 역설이 여기서 나왔다.
//
// 그래서 상한을 하나 더 씌운다: 마지막 채점 이후 실제로 지난 일수 × ease.
// 6일 만에 맞힌 건 6일치 증거이므로 15일까지가 한계고, 이미 60일을 배정받은
// 문항이면 늘릴 근거가 없어 60 그대로다(줄이지도 않는다 — 맞힌 건 사실이다).
//
// 예정일에 맞힌 정상 복습은 지난 일수 = 간격이라 상한이 곱셈 결과보다 커서
// 아무 일도 하지 않는다. 즉 이 규칙이 건드리는 건 조기 정답뿐이다.
function boundByElapsed(
  prev: SrsState,
  grown: number,
  now: Date,
  lastGradedAt?: Date | null,
): number {
  if (!lastGradedAt || prev.intervalDays <= 0) return grown;
  const elapsed = srsDayIndex(now) - srsDayIndex(lastGradedAt);
  if (elapsed <= 0) return grown;
  const evidence = Math.round(elapsed * prev.ease);
  return Math.max(prev.intervalDays, Math.min(grown, evidence));
}

// 간격을 ±SRS_FUZZ_RATIO 만큼 흔든다. rand가 없으면 그대로 둔다 — 기본을 결정적으로
// 두어야 테스트가 간격을 고정할 수 있고, 흔들지 말아야 할 자리(재확인·학습 단계)에
// 실수로 새어 들어가지 않는다.
export function fuzzInterval(days: number, rand?: () => number): number {
  if (!rand || days < SRS_FUZZ_MIN_DAYS) return days;
  const span = Math.max(1, Math.round(days * SRS_FUZZ_RATIO));
  const delta = Math.round((rand() * 2 - 1) * span);
  return Math.min(
    SRS_MAX_INTERVAL_DAYS,
    Math.max(SRS_FUZZ_MIN_DAYS, days + delta),
  );
}

export type NextSrsOptions = {
  // 지금 저장돼 있는 예약 시각(user_question_status.srs_due_at). 이걸 줘야 "예정된
  // 복습"과 "예정보다 이른 재응시"를 구분한다. 안 주면 전부 예정된 복습으로 친다.
  dueAt?: Date | null;
  // 간격 흔들기용 난수(보통 Math.random). 안 주면 흔들지 않는다.
  fuzz?: () => number;
};

// 채점 결과 하나를 스케줄에 반영한다.
//
// 틀리면 간격을 1일로 되돌리고 ease를 깎는다(다음부터 더 촘촘히 나옴).
// 맞히면 1일 → 3일 → 그 뒤로는 직전 간격 × ease 로 벌어진다. 간격 계산에는 갱신 전
// ease를 쓴다 — 이번 정답의 보너스는 다음 회차부터 반영되게 해서 한 번 맞혔다고
// 간격이 두 배로 튀지 않게 한다. 그 위에 "지난 일수 × ease" 상한을 씌운다
// (boundByElapsed) — 조기 정답이 반복될 때 성장이 복리로 쌓이는 걸 막는다.
//
// lastGradedAt(직전 채점 시각)을 주면 "하루 1회만 반영" 규칙이 걸린다. 섞어풀기는
// 쿨다운이 없어 같은 문항을 하루에 몇 번이고 다시 풀 수 있는데, 그때마다 reps가
// 올라가면 1일 → 3일 → 8일이 하루 만에 지나간다. 간격을 두고 만나야 유지력이라고
// 부를 수 있으므로, 간격 없이 연달아 맞힌 것은 유지력의 증거로 치지 않는다.
// 틀린 것은 언제나 반영한다 — 방금 맞힌 문항을 곧바로 틀렸다면 그게 진짜 신호다.
//
// 단, reps가 0인 문항(= 아직 한 번도 못 맞혔거나 방금 무너져 재확인 중)은 붙잡지
// 않는다. 그 상태의 같은 날 정답은 "연타로 간격 불리기"가 아니라 재확인 단계를
// 통과한 것이라, 여기서 막으면 그날 안에 다시 만나는 장치가 통째로 죽는다.
export function nextSrs(
  prev: SrsState,
  isCorrect: boolean,
  now: Date,
  lastGradedAt?: Date | null,
  opts: NextSrsOptions = {},
): SrsResult {
  if (
    isCorrect &&
    lastGradedAt &&
    prev.reps >= 1 &&
    prev.intervalDays >= 1 &&
    isSameSrsDay(lastGradedAt, now)
  ) {
    // 직전 채점이 오늘이므로 srsDueAt(lastGradedAt, ...)은 그때 잡힌 due를 그대로
    // 재현한다(같은 하루 번호 + 같은 간격). 별도로 due를 들고 다닐 필요가 없다.
    return { state: prev, dueAt: srsDueAt(lastGradedAt, prev.intervalDays) };
  }

  if (!isCorrect) {
    const first = isFirstEntry(prev);

    // 예정일 전에 끌려 나와 틀린 것(회독·섞어풀기)은 반감만 하고 lapse를 세지
    // 않는다. 여기서 리셋하면 회독할수록 스케줄이 무너지고, leech 카운트까지
    // 올라가 멀쩡한 문항이 큐에서 접힌다. 간격 1일짜리는 반감해도 1일이라 제외.
    if (
      !first &&
      prev.intervalDays >= 2 &&
      dueProgress(prev, now, opts.dueAt) < SRS_EARLY_LAPSE_RATIO
    ) {
      return {
        state: {
          intervalDays: Math.max(
            SRS_FIRST_INTERVAL_DAYS,
            Math.round(prev.intervalDays * SRS_EARLY_LAPSE_FACTOR),
          ),
          ease: clampEase(prev.ease - SRS_EASE_PENALTY / 2),
          // reps를 지우지 않는다. 지우면 다음 정답이 1일로 되돌아가 반감이 무의미해진다.
          reps: prev.reps,
          lapses: prev.lapses,
        },
        // 그래도 오늘 안에 한 번 더 만난다 — 못 맞힌 건 사실이다. 그 재확인에서
        // 또 틀리면 그때는 예정일이 지난 뒤라 정상 lapse로 처리된다.
        dueAt: srsRelearnDueAt(now),
      };
    }

    const lapses = first ? 0 : prev.lapses + 1;
    return {
      state: {
        intervalDays: SRS_FIRST_INTERVAL_DAYS,
        ease: first ? prev.ease : clampEase(prev.ease - SRS_EASE_PENALTY),
        reps: 0,
        lapses,
      },
      // 내일이 아니라 몇 시간 뒤. 오늘 안에 한 번 더 만나야 잊히기 전에 붙잡는다.
      // 간격(intervalDays)은 1일로 두므로, 재확인을 통과하면 거기서부터 1 → 3으로
      // 정상 출발한다.
      dueAt: srsRelearnDueAt(now),
      leech: isLeechTrigger(lapses),
    };
  }

  // 정답으로 간격을 얼마나 벌릴지는 "실제로 얼마나 버텼는지"에 비례시킨다.
  // 다 버텼으면(비율 1) 예전과 똑같이 × ease, 절반만 버텼으면 그 절반만큼만.
  // 예정일을 안 지났어도 성장이 0은 아니다 — 적은 증거에 적은 credit을 준다.
  const progress = Math.min(
    dueProgress(prev, now, opts.dueAt),
    retainedProgress(prev, now, lastGradedAt),
  );
  const growth = 1 + (prev.ease - 1) * progress;

  const reps = prev.reps + 1;
  const grown = Math.min(
    SRS_MAX_INTERVAL_DAYS,
    Math.max(1, Math.round(prev.intervalDays * growth)),
  );
  const intervalDays =
    reps === 1
      ? SRS_FIRST_INTERVAL_DAYS
      : reps === 2
        ? SRS_SECOND_INTERVAL_DAYS
        : // 흔들기(fuzz)는 상한을 씌운 뒤에 건다 — 순서가 반대면 fuzz가 상한을 넘긴다.
          fuzzInterval(boundByElapsed(prev, grown, now, lastGradedAt), opts.fuzz);

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
