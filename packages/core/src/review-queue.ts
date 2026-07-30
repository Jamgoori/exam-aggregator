// 복습 큐 편성 — 웹·모바일 공유(순수 계산).
//
// 섞어풀기는 후보를 통째로 섞어 앞에서 자른다(shuffle().slice()). 복습은 다르다:
// 무엇을 낼지는 우선순위로 고르고, 어떤 순서로 낼지는 과목을 번갈아 배치한다.
//
//  - 고르기: 연체일과 무너진 횟수를 합친 점수 순. 연체일에 상한을 씌우는 게 핵심이다
//    — 안 그러면 오래 밀린 문항이 lapses를 압도해 "자주 틀리는 문제 먼저"가 죽는다.
//  - 순서: 한 과목이 큐를 통째로 먹으면 지루하고, 과목을 섞는 편(인터리빙)이
//    학습 효과도 낫다.
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
//    승격. 나머지는 오답노트·섞어풀기가 소화한다.
//
// 즉 SRS 진입은 오직 이 승격을 통해서만 일어난다. 섞어풀기에서 대기 문항을 맞혀도
// 스케줄이 생기지 않는다 — 그러지 않으면 세션 한 번으로 신규 몫이 무력화된다.

import { srsDayIndex } from "./srs";

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
};

// 연체일에 씌우는 상한. 이게 없으면 연체 40일짜리가 lapses를 통째로 압도해서,
// "자주 무너지는 문항 먼저"가 사실상 동점 처리용 2순위로 밀린다. 2주 넘게 밀린
// 문항끼리는 며칠 더 밀렸는지가 급한 정도를 가르지 못한다 — 둘 다 이미 잊혔다.
export const OVERDUE_SCORE_CAP_DAYS = 14;

// 한 번 무너질 때마다 얹는 점수. 3이면 lapses 5짜리(=15점)가 상한까지 연체된
// 문항과 맞먹는다. 상습범이 매일 큐 안에 들어오게 하려는 값이다.
export const LAPSE_SCORE_WEIGHT = 3;

// 큐 앞자리를 다투는 점수. 높을수록 먼저.
export function duePriorityScore(c: DueCandidate, now: Date): number {
  const overdueDays = Math.max(0, srsDayIndex(now) - srsDayIndex(new Date(c.dueAt)));
  return Math.min(overdueDays, OVERDUE_SCORE_CAP_DAYS) + c.lapses * LAPSE_SCORE_WEIGHT;
}

// 점수 높은 순 → 같으면 오래 연체된 순 → 그래도 같으면 항상 같은 순서(세션마다
// 목록이 흔들리지 않게).
function byPriority(a: DueCandidate, b: DueCandidate, now: Date): number {
  const diff = duePriorityScore(b, now) - duePriorityScore(a, now);
  if (diff !== 0) return diff;
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  return a.paperId === b.paperId
    ? a.questionNumber - b.questionNumber
    : a.paperId < b.paperId
      ? -1
      : 1;
}

// 뽑힌 문항을 과목이 번갈아 나오도록 재배열한다. 과목별 묶음에서 한 개씩 돌아가며
// 꺼내되, 큐에 많이 든 과목부터 시작해 한 과목이 뒤쪽에 몰리지 않게 한다.
function interleaveBySubject(items: DueCandidate[]): DueCandidate[] {
  const groups = new Map<string, DueCandidate[]>();
  for (const it of items) {
    const key = it.subjectId ?? "";
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }
  if (groups.size <= 1) return items;

  const buckets = [...groups.values()].sort((a, b) => b.length - a.length);
  const out: DueCandidate[] = [];
  for (let i = 0; out.length < items.length; i++) {
    for (const bucket of buckets) {
      const next = bucket[i];
      if (next) out.push(next);
    }
  }
  return out;
}

// 대기 풀에서 먼저 승격할 순서. 자주 틀린 것 먼저, 같으면 오래 안 본 것 먼저.
function byPendingPriority(a: PendingCandidate, b: PendingCandidate): number {
  if (a.wrongCount !== b.wrongCount) return b.wrongCount - a.wrongCount;
  if (a.lastAnsweredAt !== b.lastAnsweredAt) return a.lastAnsweredAt < b.lastAnsweredAt ? -1 : 1;
  return a.paperId === b.paperId
    ? a.questionNumber - b.questionNumber
    : a.paperId < b.paperId
      ? -1
      : 1;
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
  const picked = [...due].sort((a, b) => byPriority(a, b, now)).slice(0, total);

  // 신규 몫은 복습으로 채우고 남은 자리 안에서만 쓴다. 복습이 상한을 다 먹은 날은
  // 새 문항이 하나도 안 들어온다 — 밀린 걸 먼저 소화하는 게 맞다.
  const room = Math.min(newLimit, total - picked.length);
  if (room > 0 && pending.length > 0) {
    for (const p of [...pending].sort(byPendingPriority).slice(0, room)) {
      picked.push({
        paperId: p.paperId,
        questionNumber: p.questionNumber,
        subjectId: p.subjectId,
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
  // 오늘로부터 며칠 뒤인지(0 = 오늘). 오늘 칸에는 연체된 것까지 모두 포함한다.
  offset: number;
  count: number;
};

// "오늘 12 · 내일 5 · 수 8 ..." 표에 쓸 향후 며칠치 분포.
//
// 무료(24시간 고정)와 유료의 차이가 사용자 눈에 드러나는 유일한 자리다 — 무료는
// 매일 같은 더미가 오늘에 몰려 있고, 유료는 날짜별로 흩어지며 0인 날이 생긴다.
// 그래서 개수가 0인 날도 빼지 않고 그대로 돌려준다.
export function forecastDueByDay(
  candidates: DueCandidate[],
  now: Date = new Date(),
  days: number = DUE_FORECAST_DAYS,
): DueForecastDay[] {
  const today = srsDayIndex(now);
  const out: DueForecastDay[] = Array.from({ length: days }, (_, offset) => ({
    offset,
    count: 0,
  }));

  for (const c of candidates) {
    // 연체분은 오늘 칸으로 접는다(지난 날짜 칸을 따로 보여줘야 할 이유가 없다).
    const offset = Math.max(0, srsDayIndex(new Date(c.dueAt)) - today);
    if (offset < days) out[offset].count++;
  }
  return out;
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
  return out.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}
