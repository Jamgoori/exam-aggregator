// 복습 알고리즘 시뮬레이터 — 가상 학습자를 몇 달치 굴려 큐 편성을 재는 도구.
//
// 왜 사람이 아니라 모델인가: 간격 반복이 검증해야 하는 축은 "망각"이다. 실제
// 사용자를 붙이거나 LLM에게 기출을 풀리면 정답률은 나오지만, 그 정답률이 "3일 전에
// 본 문항"과 "60일 전에 본 문항"으로 갈리지 않는다 — 재려는 축이 통째로 없다.
// 그래서 문항마다 기억 강도를 들고 있는 가상 학습자를 만들어, 실제 앱과 같은
// 함수(nextSrs·buildDueQueue)로 굴린다.
//
// 여기는 DB를 모른다. 앱의 쓰기 경로(apps/web/src/lib/question-status.ts)가 하는 일을
// applyGrading이 그대로 흉내 낸다 — 한쪽만 바뀌면 시뮬레이션이 조용히 거짓말을 하게
// 되므로, 채점 규칙을 고칠 때는 여기도 같이 본다.
//
// 결과는 simulate.test.ts가 임계로 고정한다. 지표의 뜻은 SimulationReport 참고.

import {
  buildDueQueue,
  newItemsForLimit,
  type DueCandidate,
  type PendingCandidate,
} from "./review-queue";
import { nextSrs, srsDayIndex, srsDayStart, SRS_INITIAL, type SrsState } from "./srs";

// ── 가상 학습자 ──────────────────────────────────────────────────────────────

export type LearnerProfile = {
  name: string;
  // 하루에 새로 푸는 문제지 수(0이면 새 진도 없음). 문제지 하나 = questionsPerPaper 문항.
  papersPerDay: number;
  questionsPerPaper: number;
  // 과목 수. 문제지를 과목에 돌아가며 배정한다(공시는 보통 5과목).
  subjects: number;
  // 처음 만난 문항을 아는 확률. 30점이면 0.3.
  baseKnowledge: number;
  // 며칠마다 예전 문제지를 통째로 다시 푸는지(회독). 0이면 안 한다.
  rereadEveryDays: number;
  // 복습 세션을 실제로 여는 확률(하루 기준). 1이면 매일 빠짐없이.
  reviewOnDays: number;
  dailyLimit: number;
};

export const PROFILES: Record<string, LearnerProfile> = {
  // 1회독 중. 유입이 처리를 크게 앞선다(확장기).
  expanding: {
    name: "확장기(하루 2장·30점)",
    papersPerDay: 2,
    questionsPerPaper: 20,
    subjects: 5,
    baseKnowledge: 0.3,
    rereadEveryDays: 0,
    reviewOnDays: 1,
    dailyLimit: 20,
  },
  // 진도를 거의 끝내고 약점만 남은 사람(정착기).
  settling: {
    name: "정착기(하루 0.5장·90점)",
    papersPerDay: 0.5,
    questionsPerPaper: 20,
    subjects: 5,
    baseKnowledge: 0.9,
    rereadEveryDays: 0,
    reviewOnDays: 1,
    dailyLimit: 20,
  },
  // 같은 문제지를 반복해 도는 사람. 복습 예정일과 무관한 채점이 계속 들어온다.
  rereading: {
    name: "회독형(3일마다 재응시)",
    papersPerDay: 1,
    questionsPerPaper: 20,
    subjects: 5,
    baseKnowledge: 0.6,
    rereadEveryDays: 3,
    reviewOnDays: 1,
    dailyLimit: 20,
  },
  // 복습을 매일 열지 않는 사람. 밀린 큐가 어떻게 흘러가는지 본다.
  irregular: {
    name: "간헐형(복습 이틀에 한 번)",
    papersPerDay: 1,
    questionsPerPaper: 20,
    subjects: 5,
    baseKnowledge: 0.5,
    rereadEveryDays: 0,
    reviewOnDays: 0.5,
    dailyLimit: 20,
  },
};

// 문항 하나에 대한 사용자의 실제 기억. SRS가 추정하려는 대상이고, 시뮬레이터만 안다.
type Memory = {
  // 기억 안정도(일). 클수록 오래 간다. 0이면 아직 모른다.
  stability: number;
  // 마지막으로 이 문항을 만난 날.
  lastSeenDay: number;
  // 문항 난이도(0.5 = 쉬움, 2 = 어려움). 성장 폭을 나눈다.
  difficulty: number;
  // 처음부터 알고 있던 문항인지(baseKnowledge로 결정). 이건 안정도가 크게 시작한다.
  known: boolean;
};

// 편중 지표를 재는 최소 큐 길이.
const METRIC_MIN_QUEUE = 10;

const CHOICE_COUNT = 4;
const GUESS_RATE = 1 / CHOICE_COUNT;

// 회상 확률. 지수 망각 곡선 — 마지막으로 만난 뒤 지난 시간이 안정도에 가까워질수록
// 급하게 떨어진다.
function recallProbability(m: Memory, day: number): number {
  if (m.stability <= 0) return 0;
  const elapsed = Math.max(0, day - m.lastSeenDay);
  return Math.exp(-elapsed / m.stability);
}

// 채점 한 번이 실제 기억에 미치는 영향.
//
// 핵심은 "겨우 떠올린 것일수록 크게 는다"(간격 효과)이다. 방금 본 문항을 또 맞히면
// 회상 확률이 1에 가까워 거의 늘지 않는다 — 벼락치기가 안 남는 이유이고, 이 모델이
// 없으면 "하루에 몰아 풀기"가 간격 반복과 똑같이 좋게 나온다.
//
// 찍어서 맞힌 것은 기억을 늘리지 않는다. 정답 여부와 기억은 다른 사건이다.
//
// 틀린 경우는 깎기만 하지 않는다. 이 앱은 채점 직후 정답과 AI 해설을 보여주므로
// 오답은 "실패 + 재학습"이다. 그걸 빼면 틀린 문항의 안정도가 0 근처에 눌러앉아
// 다음 날 정답률이 찍기 수준으로 나오고, 유지율 지표 전체가 거짓으로 낮아진다.
const RELEARN_STABILITY = 1.5;

function updateMemory(m: Memory, day: number, recalled: boolean): void {
  if (recalled) {
    const p = recallProbability(m, day);
    const gain = 1 + (1.4 * (1 - p)) / m.difficulty;
    m.stability = Math.max(1, m.stability) * gain;
  } else {
    m.stability = Math.max(RELEARN_STABILITY / m.difficulty, m.stability * 0.4);
  }
  m.lastSeenDay = day;
}

// ── 앱 상태(user_question_status) 흉내 ───────────────────────────────────────

type QuestionKey = string; // `${paperId}#${questionNumber}`

type StatusRow = {
  paperId: string;
  questionNumber: number;
  subjectId: string;
  wrongCount: number;
  lastAnsweredDay: number | null;
  // null이면 대기 풀(아직 SRS에 안 태움).
  dueDay: number | null;
  srs: SrsState;
  suspended: boolean;
};

function key(paperId: string, questionNumber: number): QuestionKey {
  return `${paperId}#${questionNumber}`;
}

// 채점 결과를 상태에 반영한다. apps/web/src/lib/question-status.ts와 같은 규칙:
// 스케줄이 있는 문항만 nextSrs를 굴리고, 대기 문항은 wrong_count만 올린다.
function applyGrading(
  status: Map<QuestionKey, StatusRow>,
  paperId: string,
  questionNumber: number,
  subjectId: string,
  isCorrect: boolean,
  day: number,
  atMs: number,
): { scheduled: boolean; prevInterval: number } {
  const k = key(paperId, questionNumber);
  const before = status.get(k);
  const row: StatusRow = before ?? {
    paperId,
    questionNumber,
    subjectId,
    wrongCount: 0,
    lastAnsweredDay: null,
    dueDay: null,
    srs: SRS_INITIAL,
    suspended: false,
  };

  const prevInterval = row.srs.intervalDays;
  let scheduled = false;

  if (row.dueDay != null) {
    scheduled = true;
    const result = nextSrs(row.srs, isCorrect, new Date(atMs), lastGradedAt(row), {
      dueAt: srsDayStart(row.dueDay),
    });
    row.srs = result.state;
    row.dueDay = srsDayIndex(result.dueAt);
    if (result.leech) row.suspended = true;
  }

  if (!isCorrect) row.wrongCount += 1;
  row.lastAnsweredDay = day;
  status.set(k, row);
  return { scheduled, prevInterval };
}

function lastGradedAt(row: StatusRow): Date | null {
  // 앱은 last_answered_at(시각)을 넘기지만 시뮬레이터는 하루 단위로만 움직인다.
  // 같은 하루 안의 두 번째 채점도 재현되도록 그날 정오로 환산한다.
  return row.lastAnsweredDay == null
    ? null
    : new Date(srsDayStart(row.lastAnsweredDay).getTime() + 8 * 60 * 60 * 1000);
}

// ── 결정적 난수 ──────────────────────────────────────────────────────────────

// 시드 고정 난수(mulberry32). 시뮬레이션이 흔들리면 임계로 회귀를 잡을 수 없다.
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 시뮬레이션 ───────────────────────────────────────────────────────────────

export type SimulationReport = {
  profile: string;
  days: number;
  // 예정된 복습에서의 간격 구간별 실제 정답률. SRS가 겨냥하는 유지율과 비교한다.
  retentionByInterval: { bucket: string; reviews: number; accuracy: number }[];
  // 오답이 처음 복습 큐에 뜨기까지 걸린 일수. 최근 오답이 굶으면 여기가 커진다.
  daysToFirstReview: { median: number; p90: number; max: number; never: number };
  // 하루 큐 안에서 "같은 문제지 문항"이 차지한 최대 비율. 사용자가 "왜 이 시험지만
  // 계속 나오지"라고 느끼는 지점.
  maxSamePaperShare: number;
  // 하루 큐 안 최다 과목 비율.
  maxSameSubjectShare: number;
  // 3일 안에 같은 문항이 다시 큐에 뜬 비율(재확인 단계 제외분). 반복 노출 체감.
  repeatWithin3Days: number;
  // 복습을 연 날 중 큐가 비어 있던 날 수.
  emptyQueueDays: number;
  // 마지막 날 기준 대기 풀(아직 SRS에 못 올라탄 오답) 크기.
  finalPending: number;
  // 마지막 날 기준 스케줄이 있는 문항 수.
  finalScheduled: number;
  // leech로 접힌 문항 수.
  suspended: number;
  // 간격 30일 이상 문항의 평균 간격(마지막 날). 밀림이 생기면 여기가 부푼다.
  matureAverageInterval: number;
  // 총 복습 채점 수 / 총 응시 채점 수.
  reviewGradings: number;
  studyGradings: number;
};

export type SimulationOptions = {
  days?: number;
  seed?: number;
};

export function simulate(
  profile: LearnerProfile,
  opts: SimulationOptions = {},
): SimulationReport {
  const days = opts.days ?? 120;
  const rand = seededRandom(opts.seed ?? 42);

  const status = new Map<QuestionKey, StatusRow>();
  const memory = new Map<QuestionKey, Memory>();
  const solvedPapers: { paperId: string; subjectId: string }[] = [];

  // 지표 수집용
  const retention = new Map<string, { reviews: number; correct: number }>();
  const firstWrongDay = new Map<QuestionKey, number>();
  const firstQueueDay = new Map<QuestionKey, number>();
  const lastQueuedDay = new Map<QuestionKey, number>();
  let repeatWithin3 = 0;
  let queuedTotal = 0;
  let maxSamePaperShare = 0;
  let maxSameSubjectShare = 0;
  let emptyQueueDays = 0;
  let reviewGradings = 0;
  let studyGradings = 0;

  const day0 = srsDayIndex(new Date("2026-01-05T09:00:00+09:00"));
  let paperSeq = 0;
  let papersOwed = 0;

  function memoryOf(k: QuestionKey, day: number): Memory {
    const found = memory.get(k);
    if (found) return found;
    const known = rand() < profile.baseKnowledge;
    const m: Memory = {
      // 원래 알던 문항은 안정도가 크게 시작한다(시험 범위 밖 개념이 아니다).
      stability: known ? 30 + rand() * 60 : 0,
      lastSeenDay: day,
      difficulty: 0.5 + rand() * 1.5,
      known,
    };
    memory.set(k, m);
    return m;
  }

  // 문항 하나를 실제로 푼다. 회상에 성공했는지와 정답인지는 다른 값이다 —
  // 4지선다는 모르고도 25%가 맞는다.
  function answer(k: QuestionKey, day: number): boolean {
    const m = memoryOf(k, day);
    const p = recallProbability(m, day);
    const recalled = rand() < p;
    const correct = recalled || rand() < GUESS_RATE;
    updateMemory(m, day, recalled);
    return correct;
  }

  function gradePaper(
    paper: { paperId: string; subjectId: string },
    day: number,
    atMs: number,
  ): void {
    for (let q = 1; q <= profile.questionsPerPaper; q++) {
      const k = key(paper.paperId, q);
      const correct = answer(k, day);
      applyGrading(status, paper.paperId, q, paper.subjectId, correct, day, atMs);
      studyGradings++;
      if (!correct && !firstWrongDay.has(k)) firstWrongDay.set(k, day);
    }
  }

  for (let d = 0; d < days; d++) {
    const day = day0 + d;
    // 그날의 시각. 오전에 진도, 오후에 복습 — 앱의 실제 순서와 같다.
    const morning = srsDayStart(day).getTime() + 5 * 60 * 60 * 1000;
    const evening = srsDayStart(day).getTime() + 14 * 60 * 60 * 1000;

    // 1) 새 문제지 응시
    papersOwed += profile.papersPerDay;
    while (papersOwed >= 1) {
      papersOwed -= 1;
      const paperId = `p${paperSeq++}`;
      const subjectId = `s${paperSeq % profile.subjects}`;
      const paper = { paperId, subjectId };
      solvedPapers.push(paper);
      gradePaper(paper, day, morning);
    }

    // 2) 회독(예전 문제지 통째로 재응시). 복습 예정일과 무관한 채점이라 스케줄을
    //    흔드는 주된 원인이다.
    if (profile.rereadEveryDays > 0 && d % profile.rereadEveryDays === 0 && solvedPapers.length > 0) {
      gradePaper(solvedPapers[Math.floor(rand() * solvedPapers.length)], day, morning);
    }

    // 3) 복습 세션
    if (rand() >= profile.reviewOnDays) continue;

    const now = new Date(evening);
    const candidates: DueCandidate[] = [];
    const pending: PendingCandidate[] = [];
    for (const row of status.values()) {
      if (row.suspended) continue;
      if (row.dueDay != null) {
        candidates.push({
          paperId: row.paperId,
          questionNumber: row.questionNumber,
          subjectId: row.subjectId,
          dueAt: srsDayStart(row.dueDay).toISOString(),
          lapses: row.srs.lapses,
        });
      } else if (row.wrongCount > 0) {
        pending.push({
          paperId: row.paperId,
          questionNumber: row.questionNumber,
          subjectId: row.subjectId,
          wrongCount: row.wrongCount,
          lastAnsweredAt: new Date(
            srsDayStart(row.lastAnsweredDay ?? day).getTime(),
          ).toISOString(),
        });
      }
    }

    const queue = buildDueQueue(candidates, pending, now, {
      total: profile.dailyLimit,
      newItems: newItemsForLimit(profile.dailyLimit),
    });
    if (queue.length === 0) {
      emptyQueueDays++;
      continue;
    }

    // 큐 구성 지표
    const byPaper = new Map<string, number>();
    const bySubject = new Map<string, number>();
    for (const it of queue) {
      byPaper.set(it.paperId, (byPaper.get(it.paperId) ?? 0) + 1);
      bySubject.set(it.subjectId ?? "", (bySubject.get(it.subjectId ?? "") ?? 0) + 1);
    }
    // 큐가 짧은 날은 비율이 무의미하다(2문항이면 같은 시험지라도 100%가 된다).
    // 편중은 "자리가 충분한 날"에만 잰다.
    if (queue.length >= METRIC_MIN_QUEUE) {
      maxSamePaperShare = Math.max(
        maxSamePaperShare,
        Math.max(...byPaper.values()) / queue.length,
      );
      maxSameSubjectShare = Math.max(
        maxSameSubjectShare,
        Math.max(...bySubject.values()) / queue.length,
      );
    }

    for (const item of queue) {
      const k = key(item.paperId, item.questionNumber);
      const row = status.get(k)!;

      // 승격: 대기 문항에 오늘자 스케줄을 심는다(review-queue.ts의 promotePendingItems).
      if (item.isNew) row.dueDay = day;

      if (!firstQueueDay.has(k)) firstQueueDay.set(k, day);
      const prevQueued = lastQueuedDay.get(k);
      if (prevQueued != null && day - prevQueued <= 3) repeatWithin3++;
      lastQueuedDay.set(k, day);
      queuedTotal++;

      const prevInterval = row.srs.intervalDays;
      const wasDue = row.dueDay != null && row.dueDay <= day;
      const correct = answer(k, day);
      applyGrading(status, item.paperId, item.questionNumber, row.subjectId, correct, day, evening);
      reviewGradings++;
      if (!correct && !firstWrongDay.has(k)) firstWrongDay.set(k, day);

      // 유지율은 "예정일이 돼서 나온 복습"만 센다. 승격 직후 첫 채점은 간격이 없어
      // 유지력을 말할 수 없다.
      if (wasDue && prevInterval >= 1) {
        const bucket = intervalBucket(prevInterval);
        const acc = retention.get(bucket) ?? { reviews: 0, correct: 0 };
        acc.reviews++;
        if (correct) acc.correct++;
        retention.set(bucket, acc);
      }
    }

    // 4) 재확인(그날 안에 다시 만나기). 틀린 문항의 due는 3시간 뒤라, 세션을 마치고
    //    조금 있다 다시 열면 그것들이 나온다. 망각이 가장 빠른 구간을 잡는 장치라
    //    빼놓고 재면 유지율이 실제보다 낮게 나온다.
    //
    //    같은 날 두 번째 노출이므로 "며칠 만에 또 나왔나" 지표에는 세지 않는다.
    const recheckAt = evening + 3 * 60 * 60 * 1000;
    const recheck = [...status.values()]
      .filter(
        (row) =>
          !row.suspended &&
          row.lastAnsweredDay === day &&
          row.dueDay != null &&
          row.dueDay <= day,
      )
      .slice(0, profile.dailyLimit);
    for (const row of recheck) {
      const correct = answer(key(row.paperId, row.questionNumber), day);
      applyGrading(
        status,
        row.paperId,
        row.questionNumber,
        row.subjectId,
        correct,
        day,
        recheckAt,
      );
      reviewGradings++;
    }
  }

  const waits: number[] = [];
  let never = 0;
  for (const [k, wrongDay] of firstWrongDay) {
    const queued = firstQueueDay.get(k);
    if (queued == null) never++;
    else waits.push(queued - wrongDay);
  }
  waits.sort((a, b) => a - b);

  let pendingLeft = 0;
  let scheduled = 0;
  let suspended = 0;
  const matureIntervals: number[] = [];
  for (const row of status.values()) {
    if (row.suspended) suspended++;
    else if (row.dueDay != null) {
      scheduled++;
      if (row.srs.intervalDays >= 30) matureIntervals.push(row.srs.intervalDays);
    } else if (row.wrongCount > 0) pendingLeft++;
  }

  return {
    profile: profile.name,
    days,
    retentionByInterval: [...retention.entries()]
      .sort((a, b) => bucketOrder(a[0]) - bucketOrder(b[0]))
      .map(([bucket, v]) => ({
        bucket,
        reviews: v.reviews,
        accuracy: v.reviews === 0 ? 0 : v.correct / v.reviews,
      })),
    daysToFirstReview: {
      median: percentile(waits, 0.5),
      p90: percentile(waits, 0.9),
      max: waits.length === 0 ? 0 : waits[waits.length - 1],
      never,
    },
    maxSamePaperShare,
    maxSameSubjectShare,
    repeatWithin3Days: queuedTotal === 0 ? 0 : repeatWithin3 / queuedTotal,
    emptyQueueDays,
    finalPending: pendingLeft,
    finalScheduled: scheduled,
    suspended,
    matureAverageInterval:
      matureIntervals.length === 0
        ? 0
        : matureIntervals.reduce((s, v) => s + v, 0) / matureIntervals.length,
    reviewGradings,
    studyGradings,
  };
}

const BUCKETS = ["1-2일", "3-7일", "8-20일", "21-60일", "60일+"] as const;

function intervalBucket(interval: number): string {
  if (interval <= 2) return BUCKETS[0];
  if (interval <= 7) return BUCKETS[1];
  if (interval <= 20) return BUCKETS[2];
  if (interval <= 60) return BUCKETS[3];
  return BUCKETS[4];
}

function bucketOrder(bucket: string): number {
  return BUCKETS.indexOf(bucket as (typeof BUCKETS)[number]);
}

function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * q));
  return sorted[idx];
}

// 사람이 읽을 표. 테스트 실패 시 원인을 눈으로 보려고 둔다.
export function formatReport(r: SimulationReport): string {
  const lines = [
    `── ${r.profile} · ${r.days}일`,
    `   응시 채점 ${r.studyGradings} · 복습 채점 ${r.reviewGradings}`,
    `   오답 → 첫 복습까지: 중앙값 ${r.daysToFirstReview.median}일 · p90 ${r.daysToFirstReview.p90}일 · 최대 ${r.daysToFirstReview.max}일 · 못 만난 문항 ${r.daysToFirstReview.never}개`,
    `   하루 큐 최대 편중: 같은 문제지 ${(r.maxSamePaperShare * 100).toFixed(0)}% · 같은 과목 ${(r.maxSameSubjectShare * 100).toFixed(0)}%`,
    `   3일 내 재노출 ${(r.repeatWithin3Days * 100).toFixed(0)}% · 빈 큐 ${r.emptyQueueDays}일`,
    `   대기 ${r.finalPending} · 스케줄 ${r.finalScheduled} · 접힘 ${r.suspended} · 성숙 간격 평균 ${r.matureAverageInterval.toFixed(1)}일`,
  ];
  for (const b of r.retentionByInterval) {
    lines.push(`   유지율 ${b.bucket}: ${(b.accuracy * 100).toFixed(0)}% (${b.reviews}회)`);
  }
  return lines.join("\n");
}
