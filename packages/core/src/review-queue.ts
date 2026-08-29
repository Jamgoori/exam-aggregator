// 복습 큐 편성 — 웹·모바일 공유(순수 계산).
//
// 섞어풀기는 후보를 통째로 섞어 앞에서 자른다(shuffle().slice()). 복습은 다르다:
// 무엇을 낼지는 우선순위로 고르고, 어떤 순서로 낼지는 과목을 번갈아 배치한다.
//
//  - 고르기: 연체일과 무너진 횟수를 합친 점수 순. 연체일에 상한을 씌우는 게 핵심이다
//    — 안 그러면 오래 밀린 문항이 lapses를 압도해 "자주 틀리는 문제 먼저"가 죽는다.
//    단, 과목마다 최소 몫을 먼저 떼어 둔다(SUBJECT_MIN_SLOTS). 점수순으로만 자르면
//    한 과목이 20자리를 통째로 먹고 다른 과목은 며칠이고 안 나온다.
//  - 순서: 한 과목이 큐를 통째로 먹으면 지루하고, 과목을 섞는 편(인터리빙)이
//    학습 효과도 낫다. 이건 "뽑은 것을 어떻게 늘어놓을지"라 뽑기와는 다른 층이다.
//
// 하루 상한이 있는 이유는 스케줄 정확도보다 중요하다. 밀린 문항이 수백 개인
// 사용자에게 그대로 다 보여주면 시작조차 안 한다 — 오늘치가 끝난다는 감각이
// 있어야 매일 돌아온다. 넘친 문항은 사라지지 않고 다음 날 큐 맨 앞에 온다.
//
// 상한만으로는 1회독 중인 사용자를 감당하지 못한다. 하루 80개씩 틀리는 사람에게
// 오답을 나는 족족 SRS에 태우면 유입 80 대 처리 20으로 매일 60씩 부채가 쌓이고,
// 큐가 연체순이라 회독 첫 주 문항만 몇 주째 돌면서 어제 무너진 문항은 영영 안
// 나온다. 그래서 상한을 두 몫으로 나눈다:
//
//  - 복습 몫: 이미 SRS에 올라탄 문항의 due. 밀리면 안 되므로 우선 채운다.
//  - 신규 몫: 아직 스케줄이 없는 오답(대기 풀)에서 하루 NEW_QUEUE_LIMIT개까지만
//    승격. 나머지는 오답노트·섞어풀기가 소화한다. 그 몫의 일부(NEW_RECENT_RATIO)는
//    최근에 틀린 문항에 떼어 둔다 — 안 그러면 어제 오답이 큐 뒤에 영영 갇힌다.
//
// 즉 SRS 진입은 오직 이 승격을 통해서만 일어난다. 섞어풀기에서 대기 문항을 맞혀도
// 스케줄이 생기지 않는다 — 그러지 않으면 세션 한 번으로 신규 몫이 무력화된다.

import { srsDayIndex } from "./srs";
import { compareKo } from "./collate";

export const DUE_QUEUE_LIMIT = 20;

// 하루에 새로 SRS에 태울 수 있는 오답 수. 크게 잡으면 며칠 뒤 복습 due가 한꺼번에
// 몰려 결국 같은 적체가 반복된다.
export const NEW_QUEUE_LIMIT = 10;

// 사용자가 고를 수 있는 하루 문항 수. 20이 기본이고, 시험이 가까우면 늘리고 여유가
// 없으면 줄인다. 임의의 숫자를 받지 않는 건 "하루 3문항" 같은 설정이 스케줄을
// 사실상 정지시키기 때문이다(유입이 처리를 영구히 앞선다).
export const DAILY_LIMIT_OPTIONS = [10, 20, 40, 60] as const;

// 저장된 값이 비었거나 목록 밖이면 기본값으로. DB 값을 그대로 믿지 않는다.
export function normalizeDailyLimit(value: number | null | undefined): number {
  const n = Number(value);
  return (DAILY_LIMIT_OPTIONS as readonly number[]).includes(n) ? n : DUE_QUEUE_LIMIT;
}

// 하루 총량에 비례해 신규 몫을 정한다(기본 20 → 10, 40 → 20). 총량만 늘리고 신규를
// 고정하면 대기 풀이 줄어드는 속도가 안 바뀌어서, 사용자가 상한을 올린 의도를
// 배신한다.
export function newItemsForLimit(total: number): number {
  return Math.max(1, Math.round((total * NEW_QUEUE_LIMIT) / DUE_QUEUE_LIMIT));
}

// 향후 며칠치를 미리 보여줄지("오늘 / 내일 / 수 / 목 ...").
export const DUE_FORECAST_DAYS = 7;

export type DueCandidate = {
  paperId: string;
  questionNumber: number;
  // 과목이 확인되지 않는 문항(문제지가 지워진 경우 등)은 null. 라운드로빈에서는
  // 자기들끼리 한 묶음으로 취급한다.
  subjectId: string | null;
  // ISO 문자열. 이 시각이 지난 문항이 "오늘 복습할 것"이다.
  dueAt: string;
  lapses: number;
  // 개념 그룹 키(해설 keyword_title 에서 파생, concept-key.ts). 해설이 아직 없는
  // 문항은 null 이고, 그런 문항에는 개념 상한을 걸지 않는다.
  conceptKey?: string | null;
  // 이번에 대기 풀에서 승격된 문항. 호출부가 스케줄을 새로 심어야 하는 대상이다.
  isNew?: boolean;
};

// 대기 풀 문항 — 틀린 적은 있지만 아직 스케줄이 없다(srs_due_at is null).
export type PendingCandidate = {
  paperId: string;
  questionNumber: number;
  subjectId: string | null;
  // 승격 순서를 정하는 값. 자주 틀린 문항일수록 먼저 SRS에 태운다.
  wrongCount: number;
  // 마지막으로 이 문항을 푼 시각(ISO). 같은 횟수면 오래 안 본 것부터.
  lastAnsweredAt: string;
  conceptKey?: string | null;
};

// 연체일에 씌우는 상한. 이게 없으면 연체 40일짜리가 lapses를 통째로 압도해서,
// "자주 무너지는 문항 먼저"가 사실상 동점 처리용 2순위로 밀린다. 2주 넘게 밀린
// 문항끼리는 며칠 더 밀렸는지가 급한 정도를 가르지 못한다 — 둘 다 이미 잊혔다.
export const OVERDUE_SCORE_CAP_DAYS = 14;

// 한 번 무너질 때마다 얹는 점수. 3이면 lapses 5짜리(=15점)가 상한까지 연체된
// 문항과 맞먹는다. 상습범이 매일 큐 안에 들어오게 하려는 값이다.
export const LAPSE_SCORE_WEIGHT = 3;

// 큐 앞자리를 다투는 점수. 높을수록 먼저. "오늘"의 날짜 번호를 미리 받아 두는 쪽을
// 내부용으로 따로 둔다 — 정렬은 같은 후보의 점수를 여러 번 묻기 때문이다(아래
// sortByPriority 참고).
function priorityScoreOn(todayIndex: number, c: DueCandidate): number {
  const overdueDays = Math.max(0, todayIndex - srsDayIndex(new Date(c.dueAt)));
  return Math.min(overdueDays, OVERDUE_SCORE_CAP_DAYS) + c.lapses * LAPSE_SCORE_WEIGHT;
}

export function duePriorityScore(c: DueCandidate, now: Date): number {
  return priorityScoreOn(srsDayIndex(now), c);
}

// 점수가 같을 때의 순서. 오래 연체된 순 → 그래도 같으면 항상 같은 순서(세션마다
// 목록이 흔들리지 않게).
function byDueTiebreak(a: DueCandidate, b: DueCandidate): number {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.paperId === b.paperId
    ? a.questionNumber - b.questionNumber
    : a.paperId < b.paperId
      ? -1
      : 1;
}

// 우선순위 정렬. 점수를 비교자 안에서 계산하지 않고 후보마다 한 번만 계산해 들고
// 정렬한다(decorate-sort-undecorate).
//
// 점수 계산에는 dueAt 문자열의 Date 파싱이 들어 있는데, 비교자 안에서 부르면 그
// 파싱이 비교 횟수(약 2·n·log₂n)만큼 반복된다. 후보 1200개면 파싱 1200번이면 될 일이
// 4만 번을 넘는다. 실측으로 4.16ms → 0.51ms (8.2배).
//
// 순서는 예전과 정확히 같다 — 점수 계산식도, 동점 처리도 그대로다.
//
// export 하는 이유: 조회 계층(apps/web/src/lib/review-queue.ts)도 "우선순위 상위 N개"를
// 따로 뽑는 자리가 있는데, 거기서 정렬 규칙을 다시 적으면 두 순서가 갈린다. 큐를
// 만드는 순서와 그 큐를 근사하는 창의 순서는 같아야 한다.
export function sortByPriority(items: DueCandidate[], now: Date): DueCandidate[] {
  const todayIndex = srsDayIndex(now);
  const decorated = items.map((c) => ({ c, score: priorityScoreOn(todayIndex, c) }));
  decorated.sort((x, y) => y.score - x.score || byDueTiebreak(x.c, y.c));
  return decorated.map((d) => d.c);
}

// 하루 20문항 기준, 과목마다 보장하는 최소 자리 수.
//
// 인터리빙은 "뽑은 것을 어떤 순서로 낼지"만 정한다. 뽑기 자체가 점수순이면 행정법
// due가 200개인 사용자는 20자리를 행정법이 통째로 먹고, 국어는 그 200개가 다 빠질
// 때까지 며칠이고 안 나온다 — 인터리빙은 그 상태에서 아무 일도 못 한다. 공시는
// 5과목을 같은 날 보므로 한 과목이 큐를 독점하는 건 그 자체로 사고다.
// (과목 보류 기능이 필요했던 것도 절반은 이 증상의 우회로였다.)
//
// 균등 배분은 하지 않는다. 최소 몫만 떼어 두고 나머지 자리는 예전처럼 위험도
// 경쟁에 맡긴다 — 밀린 과목이 더 많이 나오는 건 맞는 동작이다.
export const SUBJECT_MIN_SLOTS = 2;

// 하루 총량에 비례한 과목별 최소 몫(20 → 2, 40 → 4).
export function subjectFloorForLimit(total: number): number {
  return Math.max(1, Math.round((total * SUBJECT_MIN_SLOTS) / DUE_QUEUE_LIMIT));
}

// 한 문제지가 하루 큐에서 차지할 수 있는 자리 비율.
//
// 과목 최소 몫은 "한 과목이 큐를 먹는 것"만 막는다. 그 과목 안에서 시험지 하나가
// 자리를 다 가져가는 건 그대로 남는데, 회독 직후에는 그 시험지 문항이 한꺼번에
// due가 되므로 실제로 그렇게 된다. 사용자 눈에는 "2019 국가직 국어만 스무 개"라,
// 우선순위상 옳더라도 납득이 안 된다.
export const PAPER_MAX_SHARE = 0.25;

// 하루 총량에 비례한 문제지별 자리 상한(20 → 5, 40 → 10). 최소 2는 준다 — 1이면
// 문제지가 적은 사용자의 큐가 지나치게 흩어진다.
export function paperCapForLimit(total: number): number {
  return Math.max(2, Math.round(total * PAPER_MAX_SHARE));
}

// 한 개념이 하루 큐에서 차지할 수 있는 자리 비율.
//
// 같은 개념을 모르면 여러 해 기출에서 각각 틀리고, 그 문항들이 따로 쌓여 같은 날
// 큐에 몰린다. 문제지 상한은 이걸 못 막는다 — 2015·2018·2021 문항은 서로 다른
// 시험지라 상한에 안 걸리기 때문이다.
//
// 문제지 상한(0.25)보다 촘촘하게 잡는다. 한 개념을 하루에 세 번 보는 것보다 세
// 개념을 하루씩 보는 편이 낫고, 사용자가 "비슷한 문제만 나온다"고 느끼는 단위도
// 시험지가 아니라 개념이다.
export const CONCEPT_MAX_SHARE = 0.15;

// 하루 총량에 비례한 개념별 자리 상한(20 → 3, 40 → 6).
export function conceptCapForLimit(total: number): number {
  return Math.max(2, Math.round(total * CONCEPT_MAX_SHARE));
}

// 뽑기에 거는 그룹 상한. 문제지·개념이 같은 규칙이라 배열로 받는다.
type GroupCap<T> = { keyOf: (it: T) => string | null; max: number };

// 우선순위대로 정렬된 목록에서 cap개를 뽑되, 과목마다 minPerSubject개를 먼저
// 확보하고, 남은 자리는 그룹 상한(caps)을 넘지 않는 선에서 원래 순서로
// 채운다. 그러고도 자리가 남으면 상한을 풀고 마저 채운다 — 오늘 볼 게 스무 개인데
// 상한 때문에 다섯 개만 주면 나머지는 그냥 밀린다. 큐를 짧게 만드는 건 편중보다
// 나쁘다.
//
// 결정적이어야 한다(배너 숫자 = 세션 문항). Map은 삽입 순서를 지키고 그 순서는
// 정렬된 목록을 훑어 만들어지므로, 과목 순회 순서 = "그 과목 최고 점수" 순이다.
// 자리가 모자라면 위험한 과목부터 최소 몫을 받는다.
function takeWithSubjectFloor<T extends { subjectId: string | null; paperId: string }>(
  sorted: T[],
  cap: number,
  minPerSubject: number,
  caps: GroupCap<T>[] = [],
): T[] {
  if (cap <= 0 || sorted.length === 0) return [];
  if (sorted.length <= cap) return sorted;

  const groups = new Map<string, T[]>();
  for (const it of sorted) {
    const key = it.subjectId ?? "";
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }

  const picked: T[] = [];
  const chosen = new Set<T>();
  // 그룹 상한별 카운터. 키가 null 인 문항(개념 미상)은 세지 않는다 — 모른다는
  // 이유로 서로 묶이면 해설 없는 문항끼리 상한에 걸린다.
  const counters = caps.map(() => new Map<string, number>());
  const take = (it: T) => {
    picked.push(it);
    chosen.add(it);
    caps.forEach((c, i) => {
      const key = c.keyOf(it);
      if (key == null) return;
      counters[i].set(key, (counters[i].get(key) ?? 0) + 1);
    });
  };
  const withinCaps = (it: T) =>
    caps.every((c, i) => {
      const key = c.keyOf(it);
      return key == null || (counters[i].get(key) ?? 0) < c.max;
    });

  // 과목이 하나뿐이면 최소 몫 단계는 의미가 없다(예전처럼 순수 점수순). 문제지
  // 상한은 그때도 건다 — 한 과목만 남은 사용자야말로 같은 시험지가 몰린다.
  if (groups.size > 1) {
    // 과목 수가 많아 최소 몫을 다 못 주면 몫을 줄인다. 그래도 1은 보장한다.
    const floor = Math.max(1, Math.min(minPerSubject, Math.floor(cap / groups.size)));
    for (let i = 0; i < floor && picked.length < cap; i++) {
      for (const list of groups.values()) {
        if (picked.length >= cap) break;
        const next = list[i];
        if (!next) continue;
        take(next);
      }
    }
  }

  for (const it of sorted) {
    if (picked.length >= cap) break;
    if (chosen.has(it) || !withinCaps(it)) continue;
    take(it);
  }

  for (const it of sorted) {
    if (picked.length >= cap) break;
    if (!chosen.has(it)) take(it);
  }
  return picked;
}

// 뽑힌 문항을 늘어놓는 순서. 바로 앞 문항과 과목·문제지·개념이 겹치지 않는 것을
// 앞에서부터 골라 채운다(그리디).
//
// 예전에는 축마다 라운드로빈을 겹쳐 돌렸는데, 축이 서로 다른 분할이라 뒤에 돌린
// 것이 앞의 것을 흐트러뜨렸다(개념으로 돌리자 같은 시험지가 붙는 비율이 2% → 9%로
// 올랐다). 축이 셋이면 "번갈아"라는 규칙 자체를 한 번에 풀어야 한다.
//
// 가중치는 사용자가 반복이라고 느끼는 순서다. 같은 개념이 연달아 나오면 "또
// 대칭키?"가 제일 먼저 보이고, 그다음이 같은 시험지, 과목은 5과목뿐이라 어느 정도
// 겹치는 게 정상이다.
const ADJACENT_PENALTY = { concept: 4, paper: 2, subject: 1 };

function adjacentPenalty(a: DueCandidate, b: DueCandidate): number {
  let score = 0;
  if (a.conceptKey != null && a.conceptKey === b.conceptKey) score += ADJACENT_PENALTY.concept;
  if (a.paperId === b.paperId) score += ADJACENT_PENALTY.paper;
  if ((a.subjectId ?? "") === (b.subjectId ?? "")) score += ADJACENT_PENALTY.subject;
  return score;
}

// 우선순위 순서를 기본으로 두고, 앞 문항과 덜 겹치는 것을 먼저 낸다. 겹침이 같으면
// 우선순위가 앞선 것 — 결정적이어야 한다(배너 숫자 = 세션 문항).
function interleaveBySubject(items: DueCandidate[]): DueCandidate[] {
  if (items.length <= 2) return items;

  const remaining = [...items];
  const out: DueCandidate[] = [remaining.shift()!];

  while (remaining.length > 0) {
    const prev = out[out.length - 1];
    let bestIndex = 0;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i++) {
      const score = adjacentPenalty(prev, remaining[i]);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
        if (score === 0) break;
      }
    }
    out.push(remaining.splice(bestIndex, 1)[0]);
  }
  return out;
}

// 대기 풀에서 먼저 승격할 순서. 자주 틀린 것 먼저, 같으면 오래 안 본 것 먼저.
// (sortByPriority 와 같은 이유로 export 한다 — 조회 계층이 같은 순서를 써야 한다.)
export function byPendingPriority(a: PendingCandidate, b: PendingCandidate): number {
  if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
  if (a.lastAnsweredAt !== b.lastAnsweredAt) return a.lastAnsweredAt < b.lastAnsweredAt ? -1 : 1;
  return a.paperId === b.paperId
    ? a.questionNumber - b.questionNumber
    : a.paperId < b.paperId
      ? -1
      : 1;
}

// 최근에 틀린 순. 같은 날이면 자주 틀린 것부터.
function byRecentWrong(a: PendingCandidate, b: PendingCandidate): number {
  if (a.lastAnsweredAt !== b.lastAnsweredAt) return a.lastAnsweredAt < b.lastAnsweredAt ? 1 : -1;
  if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
  return a.paperId === b.paperId
    ? a.questionNumber - b.questionNumber
    : a.paperId < b.paperId
      ? -1
      : 1;
}

// 신규 몫 중 "최근에 틀린 것"에 떼어 두는 비율.
//
// byPendingPriority 하나로만 승격하면 1회독 중인 사용자의 어제 오답이 영영 안
// 나온다. 그 사용자의 대기 풀은 거의 전부 wrong_count 1 동점이라 실질 정렬이
// "오래된 것부터"가 되고, 조회도 그 순서로 앞에서 잘라 오기 때문이다(웹
// PENDING_FETCH_LIMIT). 대기가 2000개면 어제 틀린 문항은 앞의 것들이 다 빠질
// 때까지 후보에 들어오지도 않는다 — 하루 10개 승격이면 반년이다.
//
// 망각 곡선상 어제 오답의 재노출이 가장 싸고 효과가 크다. 그래서 몫의 일부를
// 최근분에 고정으로 떼어 둔다. 다수는 그대로 "자주 틀린 것·오래된 것"이 가져간다
// — 오래돼서 잊은 오답이 제일 위험하다는 판단은 그대로다.
export const NEW_RECENT_RATIO = 0.3;

// 신규 몫에서 최근분에 줄 자리 수. 내림이라 몫이 작을 때(3개 이하)는 0 —
// 자리가 몇 개 없을 때 쪼개면 양쪽 다 제 몫을 못 한다.
export function recentItemsForNew(newQuota: number): number {
  return Math.max(0, Math.floor(Math.max(0, newQuota) * NEW_RECENT_RATIO));
}

// 승격할 대기 문항 고르기. 최근분 몫을 목록 맨 앞에 얹은 뒤, 자르기는 한 번만
// 한다 — 두 번 자르면 과목 균등 배분이 두 조각으로 쪼개져 무너진다.
//
// 과목 번갈아 태우기(최소 몫 = 자리 전부)는 그대로 유지한다. 승격 순서가 1회독
// 중에는 전부 wrong_count 1로 동점이라, 안 걸면 한 과목이 신규 몫을 통째로 먹는다.
// 최근분은 자기 과목 묶음의 맨 앞에 서게 되므로 그 과목 몫 안에서 먼저 뽑힌다.
function pickPending(pending: PendingCandidate[], room: number): PendingCandidate[] {
  const recentRoom = Math.min(room, recentItemsForNew(room));
  const recent = recentRoom > 0 ? [...pending].sort(byRecentWrong).slice(0, recentRoom) : [];
  const chosen = new Set(recent);

  const ordered = [
    ...recent,
    ...[...pending].sort(byPendingPriority).filter((p) => !chosen.has(p)),
  ];
  // 문제지 상한도 같이 건다. 회독 직후에는 한 시험지의 오답이 무더기로 대기 풀에
  // 들어오므로, 안 걸면 오늘 승격분 전부가 같은 시험지가 된다.
  return takeWithSubjectFloor(ordered, room, room, [
    { keyOf: (p) => p.paperId, max: paperCapForLimit(room) },
    { keyOf: (p) => p.conceptKey ?? null, max: conceptCapForLimit(room) },
  ]);
}

export type DueQueueLimits = {
  // 하루에 낼 총 문항 수.
  total?: number;
  // 그중 대기 풀에서 새로 승격할 수 있는 최대 수.
  newItems?: number;
};

// 오늘 낼 큐. due가 지난 문항으로 먼저 채우고, 남은 자리에 대기 풀을 신규 몫만큼
// 승격해 붙인 뒤 과목을 섞어 돌려준다.
//
// 순수 함수이자 결정적(deterministic)이어야 한다 — 배너의 "오늘 20개"와 실제 세션
// 문항이 같아야 하는데, 둘은 같은 입력으로 이 함수를 각각 호출해 계산하기 때문이다.
// 승격 대상을 여기서 정하고 실제 쓰기는 세션 생성 시점에만 하는 것도 같은 이유다
// (배너를 보기만 한 사용자의 스케줄을 건드리지 않는다).
export function buildDueQueue(
  candidates: DueCandidate[],
  pending: PendingCandidate[] = [],
  now: Date = new Date(),
  limits: DueQueueLimits = {},
): DueCandidate[] {
  const total = Math.max(1, limits.total ?? DUE_QUEUE_LIMIT);
  const newLimit = Math.max(0, limits.newItems ?? NEW_QUEUE_LIMIT);

  const nowIso = now.toISOString();
  const due = candidates.filter((c) => c.dueAt <= nowIso);
  const picked = takeWithSubjectFloor(
    sortByPriority(due, now),
    total,
    subjectFloorForLimit(total),
    [
      { keyOf: (c) => c.paperId, max: paperCapForLimit(total) },
      { keyOf: (c) => c.conceptKey ?? null, max: conceptCapForLimit(total) },
    ],
  );

  // 신규 몫은 복습으로 채우고 남은 자리 안에서만 쓴다. 복습이 상한을 다 먹은 날은
  // 새 문항이 하나도 안 들어온다 — 밀린 걸 먼저 소화하는 게 맞다.
  const room = Math.min(newLimit, total - picked.length);
  if (room > 0 && pending.length > 0) {
    for (const p of pickPending(pending, room)) {
      picked.push({
        paperId: p.paperId,
        questionNumber: p.questionNumber,
        subjectId: p.subjectId,
        conceptKey: p.conceptKey ?? null,
        // 승격 즉시 오늘 due. 세션에서 채점되면 거기서부터 간격이 붙는다.
        dueAt: nowIso,
        lapses: 0,
        isNew: true,
      });
    }
  }

  if (picked.length === 0) return [];
  return interleaveBySubject(picked);
}

export type DueForecastDay = {
  // 오늘로부터 며칠 뒤인지(0 = 오늘).
  offset: number;
  // 그날 실제로 화면에 뜰 문항 수(하루 상한 적용 후).
  count: number;
};

export type DueForecastInput = {
  // 하루에 낼 총 문항 수.
  total?: number;
  // 그중 대기 풀에서 승격할 수 있는 최대 수.
  newItems?: number;
  // 아직 승격되지 않은 오답 수(정제 후). 앞날의 신규 몫을 채우는 재고다.
  pendingCount?: number;
  days?: number;
};

// "오늘 12 · 내일 5 · 수 8 ..." 표에 쓸 향후 며칠치 분포.
//
// 무료(24시간 고정)와 유료의 차이가 사용자 눈에 드러나는 유일한 자리다 — 무료는
// 매일 같은 더미가 오늘에 몰려 있고, 유료는 날짜별로 흩어지며 0인 날이 생긴다.
// 그래서 개수가 0인 날도 빼지 않고 그대로 돌려준다.
//
// 세는 게 아니라 buildDueQueue를 며칠치 돌린 것이다. 연체분을 그대로 오늘 칸에
// 쌓아 올리던 때는 카드 제목("오늘 복습할 20문항")과 표("오늘 136")가 같은 화면에서
// 어긋났고, 밀린 116개는 날짜가 과거라 내일 칸에 안 잡혀서 "116문항은 내일 이어서"
// 바로 밑에 "내일 −"이 떴다. 상한을 적용해 넘치는 만큼을 다음 날로 흘려보내면 세
// 숫자가 같은 뜻이 되고, "−"가 비로소 진짜 쉬는 날을 뜻한다.
//
// 다만 이건 "지금 예약된 것"의 소화 계획이지 미래 예측이 아니다. 오늘 푼 문항은
// 채점 결과에 따라 1·3·8일 뒤로 다시 들어오는데, 그 재진입은 정답률을 가정해야
// 하므로 여기서 모델링하지 않는다(앞날 칸은 실제보다 조금 적게 나온다).
export function forecastDueByDay(
  candidates: DueCandidate[],
  now: Date = new Date(),
  input: DueForecastInput = {},
): DueForecastDay[] {
  const days = input.days ?? DUE_FORECAST_DAYS;
  const total = Math.max(1, input.total ?? DUE_QUEUE_LIMIT);
  const newLimit = Math.max(0, input.newItems ?? NEW_QUEUE_LIMIT);
  let pendingLeft = Math.max(0, input.pendingCount ?? 0);

  const today = srsDayIndex(now);
  const arriving = new Array<number>(days).fill(0);
  for (const c of candidates) {
    // 연체분은 오늘 도착한 것으로 친다(지난 날짜 칸을 따로 보여줄 이유가 없다).
    const offset = Math.max(0, srsDayIndex(new Date(c.dueAt)) - today);
    if (offset < days) arriving[offset]++;
  }

  // 상한을 넘긴 만큼은 사라지지 않고 다음 날 큐 맨 앞으로 간다 — buildDueQueue가
  // 연체를 우선 채우는 것과 같은 순서다.
  let carry = 0;
  return arriving.map((incoming, offset) => {
    const pool = carry + incoming;
    const dueShown = Math.min(pool, total);
    carry = pool - dueShown;

    // 복습으로 채우고 남은 자리에만 신규가 들어온다(buildDueQueue와 같은 규칙).
    const promoted = Math.min(newLimit, total - dueShown, pendingLeft);
    pendingLeft -= promoted;

    return { offset, count: dueShown + promoted };
  });
}

// 채점 결과 화면의 "다음 복습 예약" 섹션이 쓰는 모양. 조회는 각 앱의 서버 계층이
// 하지만, 타입은 여기 둔다 — 웹 조회 모듈은 server-only라 클라이언트 컴포넌트가
// 거기서 타입을 가져오면 서버 코드를 번들로 끌고 들어올 위험이 있다.
export type SessionScheduleItem = {
  position: number;
  paperTitle: string | null;
  questionNumber: number;
  // 오늘로부터 며칠 뒤에 다시 나오는지. 스케줄이 없으면(한 번도 안 틀린 문항) null.
  dueInDays: number | null;
};

export type SessionSchedule = {
  items: SessionScheduleItem[];
  forecast: DueForecastDay[];
};

// 오늘 큐의 과목별 분포("국어 5 · 한국사 4 · 영어 3"). 많은 과목부터.
export function countBySubject(
  items: DueCandidate[],
  subjectName: (subjectId: string | null) => string | null,
): { subjectId: string | null; name: string; count: number }[] {
  const counts = new Map<string | null, number>();
  for (const it of items) counts.set(it.subjectId, (counts.get(it.subjectId) ?? 0) + 1);

  const out: { subjectId: string | null; name: string; count: number }[] = [];
  for (const [subjectId, count] of counts) {
    const name = subjectName(subjectId);
    if (!name) continue;
    out.push({ subjectId, name, count });
  }
  return out.sort((a, b) => b.count - a.count || compareKo(a.name, b.name));
}
