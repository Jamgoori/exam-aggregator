// 복습 큐 편성 — 웹·모바일 공유(순수 계산).
//
// 섞어풀기는 후보를 통째로 섞어 앞에서 자른다(shuffle().slice()). 복습은 다르다:
// 무엇을 낼지는 우선순위로 고르고, 어떤 순서로 낼지는 과목을 번갈아 배치한다.
//
//  - 고르기: 오래 연체된 것 먼저, 같으면 반복해서 무너진(lapses 많은) 것 먼저.
//    한 문항이 몇 주째 안 뽑히는 일이 없어야 한다.
//  - 순서: 한 과목이 큐를 통째로 먹으면 지루하고, 과목을 섞는 편(인터리빙)이
//    학습 효과도 낫다.
//
// 하루 상한이 있는 이유는 스케줄 정확도보다 중요하다. 밀린 문항이 수백 개인
// 사용자에게 그대로 다 보여주면 시작조차 안 한다 — 오늘치가 끝난다는 감각이
// 있어야 매일 돌아온다. 넘친 문항은 사라지지 않고 다음 날 큐 맨 앞에 온다.

import { srsDayIndex } from "./srs";

export const DUE_QUEUE_LIMIT = 20;

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
};

// 연체가 길수록, 같으면 반복해서 무너진 문항일수록 앞으로.
function byPriority(a: DueCandidate, b: DueCandidate): number {
  if (a.dueAt !== b.dueAt) return a.dueAt < b.dueAt ? -1 : 1;
  if (a.lapses !== b.lapses) return b.lapses - a.lapses;
  // 같은 조건이면 항상 같은 순서가 되도록(세션마다 목록이 흔들리지 않게).
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

// 오늘 낼 큐. now 기준으로 due가 지난 것만 상한까지 고른 뒤 과목을 섞어 돌려준다.
export function buildDueQueue(
  candidates: DueCandidate[],
  now: Date = new Date(),
  limit: number = DUE_QUEUE_LIMIT,
): DueCandidate[] {
  const nowIso = now.toISOString();
  const due = candidates.filter((c) => c.dueAt <= nowIso);
  if (due.length === 0) return [];
  const picked = [...due].sort(byPriority).slice(0, Math.max(1, limit));
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
