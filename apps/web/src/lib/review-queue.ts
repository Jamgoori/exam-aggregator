import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDueQueue,
  countBySubject,
  forecastDueByDay,
  srsDayIndex,
  newItemsForLimit,
  DUE_FORECAST_DAYS,
  type DueCandidate,
  type DueForecastDay,
  type PendingCandidate,
  type SessionSchedule,
  type SessionScheduleItem,
} from "@gongmoa/core";
import { representativePaperIds } from "@/lib/dedup-papers";
import { fetchQuestionMedia, fetchWrongNoteMarks } from "@/lib/wrong-notes";
import { getReviewPrefs } from "@/lib/review-preferences";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 복습 큐 조회(유료 전용 기능의 데이터 계층). 섞어풀기 후보 수집
// (collectAllReviewCandidates)과 같은 정제 규칙을 쓰되, 뽑는 기준이 다르다:
//
//  - 섞어풀기: 미극복 오답 전부 → 무작위
//  - 복습:     srs_due_at 이 지난 것 → 연체 순 (극복한 문항도 간격을 두고 다시 온다)
//
// 편성 규칙(정렬·상한·과목 섞기)은 packages/core/review-queue.ts에 있다 — 웹과 앱이
// 같은 큐를 내야 하고, 그 규칙은 테스트로 고정돼 있다.
//
// 대기 풀은 별도 컬럼 없이 "wrong_count > 0 이면서 srs_due_at is null" 로 표현한다.
// 채점 경로가 스케줄 없는 문항에 due를 심지 않으므로(question-status.ts), 이 조합은
// 곧 "틀린 적은 있지만 아직 SRS에 안 태운 오답"이다. 여기서 하루 신규 몫만큼 뽑아
// 승격한다.

const BATCH_SIZE = 1000;

// 대기 풀에서 한 번에 훑어올 최대 행 수. 신규 몫이 10개라 이 정도면 정제(이미지
// 없음·삭제 마크·보류 과목)로 걸러지고도 충분히 남는다. 1회독 중인 사용자는 대기가
// 수백 개라 전량을 끌어오면 조회만 무거워진다.
const PENDING_FETCH_LIMIT = 300;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type StatusRow = {
  paper_id: string;
  question_number: number;
  last_answered_at: string;
  srs_due_at: string;
  srs_lapses: number | null;
};

type PendingRow = {
  paper_id: string;
  question_number: number;
  last_answered_at: string;
  wrong_count: number | null;
};

// 7일 표까지 한 번에 그리려면 "오늘 due"만이 아니라 그 앞 며칠치가 필요하다.
// 한 번 모아서 오늘 큐와 표가 같은 데이터를 쓰게 한다 — 따로 조회하면 "표엔 5개인데
// 큐엔 3개" 같은 어긋남이 생긴다.
function forecastWindowEnd(now: Date): string {
  const endDayIndex = srsDayIndex(now) + DUE_FORECAST_DAYS;
  return new Date(
    (endDayIndex * 24 + 4) * 60 * 60 * 1000 - 9 * 60 * 60 * 1000,
  ).toISOString();
}

// 향후 DUE_FORECAST_DAYS일 안에 볼 문항 후보. 정제 규칙은 섞어풀기와 동일하게
// 맞춘다(대표 시험지로 접기, 삭제 마크 제외, 이미지 있는 것만) — 여기가 어긋나면
// 배너에 뜬 숫자와 실제 세션 문항 수가 달라진다.
export async function collectDueCandidates(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<{
  candidates: DueCandidate[];
  // 오늘 승격 후보(정제 완료). 실제로 몇 개를 태울지는 buildDueQueue가 정한다.
  pending: PendingCandidate[];
  // 승격 대상 후보의 실제 저장 위치. 후보의 paperId는 dedup 대표로 접힌 값이라
  // 그대로 update 하면 행을 못 찾는다(중복 시험지로 응시한 경우). 대표 키 →
  // 원본 paper_id 목록으로 되짚을 수 있게 함께 돌려준다.
  pendingSources: Map<string, string[]>;
  // 대기 중인 오답 총계 — "나머지는 오답노트에서 기다리는 중"을 보여주는 값.
  pendingTotal: number;
  subjectNames: Map<string, string>;
  pausedSubjectIds: Set<string>;
  // 사용자가 고른 하루 문항 수. 큐 편성과 요약이 같은 값을 써야 하므로 여기서 함께
  // 실어 보낸다(따로 읽으면 왕복이 늘고, 그 사이 값이 바뀌면 숫자가 어긋난다).
  dailyLimit: number;
}> {
  const windowEnd = forecastWindowEnd(now);
  const { pausedSubjectIds: paused, dailyLimit } = await getReviewPrefs(supabase, userId);

  const empty = {
    candidates: [] as DueCandidate[],
    pending: [] as PendingCandidate[],
    pendingSources: new Map<string, string[]>(),
    subjectNames: new Map<string, string>(),
    pausedSubjectIds: paused,
    dailyLimit,
  };

  const statusRows: StatusRow[] = [];
  {
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("user_question_status")
        .select("paper_id, question_number, last_answered_at, srs_due_at, srs_lapses")
        .eq("user_id", userId)
        .not("srs_due_at", "is", null)
        .lte("srs_due_at", windowEnd)
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      statusRows.push(...(data as StatusRow[]));
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }

  // 대기 풀. 승격 순서(자주 틀린 것 먼저)대로 앞에서부터 훑어온다 — 정렬을 DB에
  // 맡겨야 수백 개 중 상위만 가져올 수 있다. 총계는 별도 count로 센다(정제 전
  // 숫자라 실제 승격 가능 수보다 약간 클 수 있지만, 화면에 쓰는 건 "얼마나 밀려
  // 있는지"라 이 정도 오차는 의미가 없다).
  const [{ data: pendingData }, { count: pendingCount }] = await Promise.all([
    supabase
      .from("user_question_status")
      .select("paper_id, question_number, last_answered_at, wrong_count")
      .eq("user_id", userId)
      .is("srs_due_at", null)
      .gt("wrong_count", 0)
      .order("wrong_count", { ascending: false })
      .order("last_answered_at", { ascending: true })
      .limit(PENDING_FETCH_LIMIT),
    supabase
      .from("user_question_status")
      .select("paper_id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("srs_due_at", null)
      .gt("wrong_count", 0),
  ]);
  const pendingRows = (pendingData ?? []) as PendingRow[];
  const pendingTotal = pendingCount ?? 0;

  if (statusRows.length === 0 && pendingRows.length === 0) {
    return { ...empty, pendingTotal };
  }

  const marks = await fetchWrongNoteMarks(supabase, userId);
  const paperIds = [
    ...new Set([...statusRows, ...pendingRows].map((r) => r.paper_id)),
  ];

  type PaperMeta = {
    id: string;
    subject_id: string;
    exam_type_id: string;
    year: number;
    round: number;
    level: string | null;
    subjects: { id: string; name: string } | null;
  };
  const papers: PaperMeta[] = [];
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await supabase
      .from("exam_papers")
      .select("id, subject_id, exam_type_id, year, round, level, subjects(id, name)")
      .in("id", ids);
    for (const p of (data ?? []) as unknown as PaperMeta[]) papers.push(p);
  }

  const { repByPaperId } = representativePaperIds(
    papers.map((p) => ({ ...p, title: "" })),
  );
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;

  const subjectOfPaper = new Map<string, { id: string; name: string }>();
  for (const p of papers) if (p.subjects) subjectOfPaper.set(p.id, p.subjects);

  const deletedRepKeys = new Set<string>();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }

  // (대표, 문항)별 최신 상태로 접는다. SRS 행은 원본 paper_id에 저장되므로, 중복
  // 시험지를 각각 응시했다면 같은 문항의 스케줄이 여러 벌 있을 수 있다. 극복 판정과
  // 같은 규칙(last_answered_at 최신 행)으로 하나만 남겨 기준이 어긋나지 않게 한다.
  const byRepQ = new Map<
    string,
    { dueAt: string; lapses: number; at: string; subjectId: string | null }
  >();
  for (const r of statusRows) {
    const rep = repId(r.paper_id);
    const key = `${rep}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const ex = byRepQ.get(key);
    if (ex && r.last_answered_at <= ex.at) continue;
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    byRepQ.set(key, {
      dueAt: r.srs_due_at,
      lapses: r.srs_lapses ?? 0,
      at: r.last_answered_at,
      subjectId: subj?.id ?? null,
    });
  }

  // 대기 풀도 같은 규칙으로 접는다. 틀린 횟수는 최댓값을 쓴다 — 중복 시험지로 나눠
  // 응시했으면 어느 한 행만 봐서는 "몇 번 무너진 문항인지"가 실제보다 작게 나오고,
  // 그러면 승격 순서가 밀린다(collectAllReviewCandidates와 같은 판단).
  const pendingByRepQ = new Map<
    string,
    { wrongCount: number; at: string; subjectId: string | null }
  >();
  const pendingSources = new Map<string, string[]>();
  for (const r of pendingRows) {
    const rep = repId(r.paper_id);
    const key = `${rep}#${r.question_number}`;
    if (deletedRepKeys.has(key)) continue;
    const sources = pendingSources.get(key) ?? [];
    if (!sources.includes(r.paper_id)) sources.push(r.paper_id);
    pendingSources.set(key, sources);
    // 같은 문항이 이미 스케줄을 갖고 있으면(중복 시험지 중 한쪽만 승격된 경우)
    // 대기 후보로 다시 세지 않는다 — 승격하면 같은 문제가 두 벌 들어간다.
    if (byRepQ.has(key)) continue;
    const ex = pendingByRepQ.get(key);
    const wrongCount = Math.max(ex?.wrongCount ?? 0, r.wrong_count ?? 0);
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    if (!ex || r.last_answered_at > ex.at) {
      pendingByRepQ.set(key, {
        wrongCount,
        at: r.last_answered_at,
        subjectId: subj?.id ?? null,
      });
    } else {
      ex.wrongCount = wrongCount;
    }
  }

  const repIds = [
    ...new Set(
      [...byRepQ.keys(), ...pendingByRepQ.keys()].map((k) => k.slice(0, k.lastIndexOf("#"))),
    ),
  ];
  const mediaByPaper = await fetchQuestionMedia(supabase, repIds);

  const candidates: DueCandidate[] = [];
  for (const [key, v] of byRepQ) {
    const idx = key.lastIndexOf("#");
    const paperId = key.slice(0, idx);
    const questionNumber = Number(key.slice(idx + 1));
    // 이미지가 없으면 문제를 그릴 수 없어 못 푼다 — 배너 숫자에서도 빼야 한다.
    if (!mediaByPaper.get(paperId)?.get(questionNumber)?.images.length) continue;
    // 보류한 과목은 큐에서도 예보에서도 뺀다. 스케줄(srs_due_at) 자체는 건드리지
    // 않는다 — 보류는 "잠깐 안 보는 것"이지 진도를 지우는 게 아니고, 다시 켤 때
    // 밀린 것을 며칠에 걸쳐 되살린다(review-preferences.ts).
    if (v.subjectId && paused.has(v.subjectId)) continue;
    candidates.push({
      paperId,
      questionNumber,
      subjectId: v.subjectId,
      dueAt: v.dueAt,
      lapses: v.lapses,
    });
  }

  // 대기 후보도 같은 정제(이미지 있음·보류 과목 제외)를 거친다. 여기가 어긋나면
  // 승격해 놓고 화면에 못 그리는 문항이 생긴다.
  const pending: PendingCandidate[] = [];
  for (const [key, v] of pendingByRepQ) {
    const idx = key.lastIndexOf("#");
    const paperId = key.slice(0, idx);
    const questionNumber = Number(key.slice(idx + 1));
    if (!mediaByPaper.get(paperId)?.get(questionNumber)?.images.length) continue;
    if (v.subjectId && paused.has(v.subjectId)) continue;
    pending.push({
      paperId,
      questionNumber,
      subjectId: v.subjectId,
      wrongCount: v.wrongCount,
      lastAnsweredAt: v.at,
    });
  }

  const subjectNames = new Map<string, string>();
  for (const s of subjectOfPaper.values()) if (!paused.has(s.id)) subjectNames.set(s.id, s.name);

  return {
    candidates,
    pending,
    pendingSources,
    pendingTotal,
    subjectNames,
    pausedSubjectIds: paused,
    dailyLimit,
  };
}

export type DueReviewSummary = {
  // 오늘 실제로 낼 문항 수(상한 적용 후). 배너에 뜨는 숫자가 곧 세션 문항 수다.
  todayCount: number;
  // 상한에 걸려 다음으로 밀린 문항 수. 0보다 크면 "오늘치가 끝난다"를 알려줄 수 있다.
  deferredCount: number;
  // 오늘 큐에 든 것 중 이번에 새로 태우는 문항 수("처음 보는 오답 N개").
  newCount: number;
  // 아직 SRS에 안 태운 오답 총계. 승격되지 않은 나머지가 사라진 게 아니라 오답노트에
  // 있다는 걸 알려주는 값 — 이게 없으면 1회독 중인 사용자는 오답이 증발했다고 읽는다.
  pendingTotal: number;
  // 지금 due가 지난 문항 전체(상한 적용 전). "밀린 복습 정리하기"를 언제 권할지
  // 판단하는 값이다.
  overdueTotal: number;
  // 아직 시각이 안 됐지만 오늘 안에 다시 나올 문항 수(재확인 단계). 이걸 안 세면
  // 세션을 막 끝낸 사용자에게 "오늘 복습할 문항 없어요"가 뜨고, 세 시간 뒤 숫자가
  // 다시 생겨서 기능이 제멋대로 구는 것처럼 보인다.
  relearnCount: number;
  // 사용자가 고른 하루 문항 수.
  dailyLimit: number;
  subjects: { subjectId: string | null; name: string; count: number }[];
  forecast: DueForecastDay[];
  // 오늘 큐가 비었을 때 다음 복습이 며칠 뒤인지(없으면 null). 0인 날을 그냥 비워두면
  // 사용자는 기능이 멈춘 걸로 오해한다.
  nextDueOffset: number | null;
};

// 배너·결과 화면이 쓰는 요약. 큐 편성과 같은 후보에서 계산해 숫자가 어긋나지 않는다.
export async function getDueReviewSummary(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<DueReviewSummary> {
  const { candidates, pending, pendingTotal, subjectNames, dailyLimit } =
    await collectDueCandidates(supabase, userId, now);
  const queue = buildDueQueue(candidates, pending, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit),
  });

  const nowIso = now.toISOString();
  const dueTotal = candidates.filter((c) => c.dueAt <= nowIso).length;
  const newCount = queue.filter((c) => c.isNew).length;

  // 재확인은 "오늘 안, 아직 시각 전"이다. 하루 경계(KST 04:00)를 쓰므로 자정을
  // 넘겨 예약된 것도 같은 하루로 잡힌다.
  const today = srsDayIndex(now);
  const relearnCount = candidates.filter(
    (c) => c.dueAt > nowIso && srsDayIndex(new Date(c.dueAt)) === today,
  ).length;

  const forecast = forecastDueByDay(candidates, now);
  const nextDue = forecast.find((d) => d.offset > 0 && d.count > 0);

  return {
    todayCount: queue.length,
    // 승격된 신규는 상한에 걸린 게 아니므로 "밀린 수"에서 뺀다.
    deferredCount: Math.max(0, dueTotal - (queue.length - newCount)),
    newCount,
    // 오늘 태울 몫은 이미 큐에 들어왔으니 대기 중 숫자에서 뺀다.
    pendingTotal: Math.max(0, pendingTotal - newCount),
    overdueTotal: dueTotal,
    relearnCount,
    dailyLimit,
    subjects: countBySubject(queue, (id) => (id ? (subjectNames.get(id) ?? null) : null)),
    forecast,
    nextDueOffset: queue.length === 0 ? (nextDue?.offset ?? null) : null,
  };
}

// 채점 직후 결과 화면에 붙일 "다음에 언제 다시 보는지".
//
// 방금 푼 문항으로 스케줄을 보여주는 자리라 설득력이 가장 크다 — 허브 같은 별도
// 화면의 추상적인 표보다, 본인이 방금 틀린 문제가 "내일", 맞힌 문제가 "8일 뒤"로
// 갈리는 걸 보는 쪽이 간격 반복이 뭔지 단번에 이해시킨다.
//
// 맞힌 문항이 다시 나온다는 사실을 여기서 미리 알려두지 않으면, 나중에 큐에 뜬 걸
// 보고 버그로 신고한다("극복했는데 왜 또 나와요").
export async function getSessionSchedule(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
): Promise<SessionSchedule | null> {
  const admin = createAdminClient();

  const { data: session } = await admin
    .from("review_sessions")
    .select("id, user_id, submitted_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (!session || session.user_id !== userId || session.submitted_at == null) return null;

  const { data: itemRows } = await admin
    .from("review_session_items")
    .select("paper_id, question_number, position")
    .eq("session_id", sessionId)
    .order("position", { ascending: true });
  const sessionItems = (itemRows ?? []) as {
    paper_id: string;
    question_number: number;
    position: number;
  }[];
  if (sessionItems.length === 0) return null;

  const paperIds = [...new Set(sessionItems.map((r) => r.paper_id))];

  const dueByKey = new Map<string, string>();
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number, srs_due_at")
      .eq("user_id", userId)
      .in("paper_id", ids)
      .not("srs_due_at", "is", null);
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      srs_due_at: string;
    }[]) {
      dueByKey.set(`${r.paper_id}#${r.question_number}`, r.srs_due_at);
    }
  }

  const titleById = new Map<string, string>();
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await supabase.from("exam_papers").select("id, title").in("id", ids);
    for (const p of (data ?? []) as { id: string; title: string }[]) {
      titleById.set(p.id, p.title);
    }
  }

  const today = srsDayIndex(now);
  const items: SessionScheduleItem[] = sessionItems.map((it) => {
    const due = dueByKey.get(`${it.paper_id}#${it.question_number}`);
    return {
      position: it.position,
      paperTitle: titleById.get(it.paper_id) ?? null,
      questionNumber: it.question_number,
      dueInDays: due ? Math.max(0, srsDayIndex(new Date(due)) - today) : null,
    };
  });

  const { candidates } = await collectDueCandidates(supabase, userId, now);
  return { items, forecast: forecastDueByDay(candidates, now) };
}

// 승격: 대기 풀에서 뽑힌 문항에 오늘자 스케줄을 심는다. 이 쓰기가 있어야 다음날부터
// 정상적으로 due 계산에 참여한다.
//
// 간격·ease·reps는 손대지 않는다(초기값 그대로). 대기 중에 섞어풀기로 몇 번 맞혔든
// 그건 간격을 두고 맞힌 게 아니라 유지력의 증거로 칠 수 없어서다 — 승격된 문항은
// 세션에서 채점되는 순간부터 1일 → 3일로 정상 출발한다.
//
// user_question_status는 쓰기 정책이 없는 테이블이라 service_role로만 고친다.
async function promotePendingItems(
  promoted: DueCandidate[],
  pendingSources: Map<string, string[]>,
  userId: string,
  now: Date,
): Promise<void> {
  if (promoted.length === 0) return;
  const admin = createAdminClient();
  const nowIso = now.toISOString();

  for (const c of promoted) {
    const key = `${c.paperId}#${c.questionNumber}`;
    // 대표 키로 접힌 후보를 원본 행들로 되돌린다. 매핑이 없으면(이론상 없어야 하지만)
    // 대표 id로라도 시도한다.
    const paperIds = pendingSources.get(key) ?? [c.paperId];
    await admin
      .from("user_question_status")
      .update({ srs_due_at: nowIso, updated_at: nowIso })
      .eq("user_id", userId)
      .eq("question_number", c.questionNumber)
      .in("paper_id", paperIds)
      // 그 사이 다른 경로로 스케줄이 생겼으면 덮어쓰지 않는다.
      .is("srs_due_at", null);
  }
}

// 오늘 큐에 들어갈 (문제지, 문항) 목록. 세션 생성이 이걸 그대로 쓴다.
//
// 승격 쓰기가 여기 붙어 있는 이유: 배너(getDueReviewSummary)는 같은 계산을 읽기만
// 하고, 실제로 세션을 시작할 때만 스케줄이 심긴다. 배너를 보기만 한 사용자의 진도를
// 건드리지 않으면서도, buildDueQueue가 결정적이라 배너 숫자와 세션 문항이 일치한다.
export async function collectDueQueueItems(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<{ paperId: string; questionNumber: number }[]> {
  const { candidates, pending, pendingSources, dailyLimit } = await collectDueCandidates(
    supabase,
    userId,
    now,
  );
  const queue = buildDueQueue(candidates, pending, now, {
    total: dailyLimit,
    newItems: newItemsForLimit(dailyLimit),
  });

  try {
    await promotePendingItems(
      queue.filter((c) => c.isNew),
      pendingSources,
      userId,
      now,
    );
  } catch {
    // 무시: 승격 실패가 세션 시작을 막지 않는다. 스케줄이 안 심긴 문항은 대기 풀에
    // 남아 다음 기회에 다시 뽑힌다(오늘 세션에서는 정상적으로 풀린다).
  }

  return queue.map((c) => ({ paperId: c.paperId, questionNumber: c.questionNumber }));
}
