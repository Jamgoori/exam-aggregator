import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildDueQueue,
  countBySubject,
  forecastDueByDay,
  srsDayIndex,
  DUE_FORECAST_DAYS,
  DUE_QUEUE_LIMIT,
  type DueCandidate,
  type DueForecastDay,
  type SessionSchedule,
  type SessionScheduleItem,
} from "@gongmoa/core";
import { representativePaperIds } from "@/lib/dedup-papers";
import { fetchQuestionMedia, fetchWrongNoteMarks } from "@/lib/wrong-notes";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 복습 큐 조회(유료 전용 기능의 데이터 계층). 섞어풀기 후보 수집
// (collectAllReviewCandidates)과 같은 정제 규칙을 쓰되, 뽑는 기준이 다르다:
//
//  - 섞어풀기: 미극복 오답 전부 → 무작위
//  - 복습:     srs_due_at 이 지난 것 → 연체 순 (극복한 문항도 간격을 두고 다시 온다)
//
// 편성 규칙(정렬·상한·과목 섞기)은 packages/core/review-queue.ts에 있다 — 웹과 앱이
// 같은 큐를 내야 하고, 그 규칙은 테스트로 고정돼 있다.

const BATCH_SIZE = 1000;

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
): Promise<{ candidates: DueCandidate[]; subjectNames: Map<string, string> }> {
  const windowEnd = forecastWindowEnd(now);

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
  if (statusRows.length === 0) return { candidates: [], subjectNames: new Map() };

  const marks = await fetchWrongNoteMarks(supabase, userId);
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];

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

  const repIds = [...new Set([...byRepQ.keys()].map((k) => k.slice(0, k.lastIndexOf("#"))))];
  const mediaByPaper = await fetchQuestionMedia(supabase, repIds);

  const candidates: DueCandidate[] = [];
  for (const [key, v] of byRepQ) {
    const idx = key.lastIndexOf("#");
    const paperId = key.slice(0, idx);
    const questionNumber = Number(key.slice(idx + 1));
    // 이미지가 없으면 문제를 그릴 수 없어 못 푼다 — 배너 숫자에서도 빼야 한다.
    if (!mediaByPaper.get(paperId)?.get(questionNumber)?.images.length) continue;
    candidates.push({
      paperId,
      questionNumber,
      subjectId: v.subjectId,
      dueAt: v.dueAt,
      lapses: v.lapses,
    });
  }

  const subjectNames = new Map<string, string>();
  for (const s of subjectOfPaper.values()) subjectNames.set(s.id, s.name);

  return { candidates, subjectNames };
}

export type DueReviewSummary = {
  // 오늘 실제로 낼 문항 수(상한 적용 후). 배너에 뜨는 숫자가 곧 세션 문항 수다.
  todayCount: number;
  // 상한에 걸려 다음으로 밀린 문항 수. 0보다 크면 "오늘치가 끝난다"를 알려줄 수 있다.
  deferredCount: number;
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
  const { candidates, subjectNames } = await collectDueCandidates(supabase, userId, now);
  const queue = buildDueQueue(candidates, now, DUE_QUEUE_LIMIT);

  const nowIso = now.toISOString();
  const dueTotal = candidates.filter((c) => c.dueAt <= nowIso).length;

  const forecast = forecastDueByDay(candidates, now);
  const nextDue = forecast.find((d) => d.offset > 0 && d.count > 0);

  return {
    todayCount: queue.length,
    deferredCount: Math.max(0, dueTotal - queue.length),
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

// 오늘 큐에 들어갈 (문제지, 문항) 목록. 세션 생성이 이걸 그대로 쓴다.
export async function collectDueQueueItems(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<{ paperId: string; questionNumber: number }[]> {
  const { candidates } = await collectDueCandidates(supabase, userId, now);
  return buildDueQueue(candidates, now, DUE_QUEUE_LIMIT).map((c) => ({
    paperId: c.paperId,
    questionNumber: c.questionNumber,
  }));
}
