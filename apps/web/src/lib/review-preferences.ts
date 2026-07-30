import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeDailyLimit,
  spreadResumeDueDates,
  DAILY_LIMIT_OPTIONS,
} from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 복습 과목 보류 설정. 보류한 과목은 복습 큐·예보·홈 유도 모달에서 전부 빠진다.
//
// 저장은 "뺄 과목"(paused_subject_ids) 목록이다. 담을 과목을 고르는 include 목록이
// 아닌 이유는 schema.sql 에 적어 뒀다 — 요약하면 나중에 새로 시작한 과목이 기본으로
// 켜져 있어야 하기 때문이다.

const BATCH_SIZE = 1000;
const UPSERT_CHUNK = 500;

export type ReviewPrefs = {
  pausedSubjectIds: Set<string>;
  // 하루에 낼 문항 수. 목록 밖 값은 기본값으로 정규화된다.
  dailyLimit: number;
};

// 큐 편성이 매번 부르는 조회라 한 번에 다 읽는다(설정 두 개를 따로 읽으면 페이지당
// 왕복이 하나 더 는다).
export async function getReviewPrefs(
  supabase: Supabase,
  userId: string,
): Promise<ReviewPrefs> {
  const { data } = await supabase
    .from("review_preferences")
    .select("paused_subject_ids, daily_limit")
    .eq("user_id", userId)
    .maybeSingle();
  return {
    pausedSubjectIds: new Set(
      ((data?.paused_subject_ids ?? []) as string[]).filter(Boolean),
    ),
    dailyLimit: normalizeDailyLimit(data?.daily_limit as number | null | undefined),
  };
}

export async function getPausedSubjectIds(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  return (await getReviewPrefs(supabase, userId)).pausedSubjectIds;
}

export type SetDailyLimitResult = { error?: string; dailyLimit?: number };

// 하루 문항 수 저장. 목록 밖 값은 거절한다 — 클라이언트가 보내는 값이라 그대로
// 저장하면 "하루 1문항"이나 음수로 복습을 정지시킬 수 있다.
export async function setDailyLimit(
  supabase: Supabase,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<SetDailyLimitResult> {
  if (!(DAILY_LIMIT_OPTIONS as readonly number[]).includes(limit)) {
    return { error: "고를 수 없는 값이에요." };
  }
  const { error } = await supabase.from("review_preferences").upsert(
    { user_id: userId, daily_limit: limit, updated_at: now.toISOString() },
    { onConflict: "user_id" },
  );
  if (error) return { error: "하루 문항 수를 저장하지 못했어요." };
  return { dailyLimit: limit };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export type ReviewSubjectOption = {
  id: string;
  name: string;
  paused: boolean;
  // 이 과목에 복습이 예약된 문항 수(날짜 무관).
  scheduledCount: number;
  // 아직 승격되지 않고 순서를 기다리는 오답 수.
  pendingCount: number;
};

// 설정 화면에 띄울 과목 목록. 복습 큐 후보(collectDueCandidates)에서 뽑지 않는
// 이유는 그쪽이 앞으로 7일치만 보기 때문이다 — 다음 복습이 40일 뒤인 과목은 큐에
// 안 잡히는데, 그 과목을 보류하지도 못하게 되면 설정이 반쪽이 된다.
//
// 예약된 문항뿐 아니라 대기 중인 오답까지 센다. 안 그러면 1회독 중이라 아직 승격이
// 하나도 안 된 과목이 목록에서 통째로 빠져, 정작 "이 과목은 당분간 쉬고 싶다"를
// 지금 정하고 싶은 사람이 그럴 수 없다. 조건이 wrong_count > 0 하나로 끝나는 건
// srs_due_at 이 있으면 반드시 틀린 적이 있기 때문이다(복습은 오답에서만 출발한다).
export async function getReviewSubjectOptions(
  supabase: Supabase,
  userId: string,
): Promise<ReviewSubjectOption[]> {
  const byPaper = new Map<string, { scheduled: number; pending: number }>();
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, srs_due_at")
      .eq("user_id", userId)
      .gt("wrong_count", 0)
      .range(from, from + BATCH_SIZE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as { paper_id: string; srs_due_at: string | null }[]) {
      const cur = byPaper.get(r.paper_id) ?? { scheduled: 0, pending: 0 };
      if (r.srs_due_at) cur.scheduled++;
      else cur.pending++;
      byPaper.set(r.paper_id, cur);
    }
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  if (byPaper.size === 0) return [];

  const names = new Map<string, string>();
  const counts = new Map<string, { scheduled: number; pending: number }>();
  for (const ids of chunk([...byPaper.keys()], 100)) {
    const { data } = await supabase
      .from("exam_papers")
      .select("id, subjects(id, name)")
      .in("id", ids);
    for (const row of (data ?? []) as unknown as {
      id: string;
      subjects: { id: string; name: string } | null;
    }[]) {
      if (!row.subjects) continue;
      names.set(row.subjects.id, row.subjects.name);
      const add = byPaper.get(row.id) ?? { scheduled: 0, pending: 0 };
      const cur = counts.get(row.subjects.id) ?? { scheduled: 0, pending: 0 };
      counts.set(row.subjects.id, {
        scheduled: cur.scheduled + add.scheduled,
        pending: cur.pending + add.pending,
      });
    }
  }

  const paused = await getPausedSubjectIds(supabase, userId);
  return [...names]
    .map(([id, name]) => {
      const c = counts.get(id) ?? { scheduled: 0, pending: 0 };
      return {
        id,
        name,
        paused: paused.has(id),
        scheduledCount: c.scheduled,
        pendingCount: c.pending,
      };
    })
    // 문항이 많은 과목부터. 끌지 말지 고민되는 게 대체로 그쪽이다.
    .sort(
      (a, b) =>
        b.scheduledCount + b.pendingCount - (a.scheduledCount + a.pendingCount) ||
        a.name.localeCompare(b.name, "ko"),
    );
}

// 보류를 풀 때, 그동안 밀려 연체가 된 그 과목 문항을 며칠에 걸쳐 다시 뿌린다.
// 안 하면 재개 첫날 예보 오늘 칸이 수백으로 뜨고(사용자는 고장으로 읽는다), 큐
// 우선순위가 연체순이라 그 과목이 하루 상한을 통째로 먹어 다른 과목이 몇 주째
// 안 나온다. 나누는 규칙 자체는 packages/core/review-resume.ts에 있다.
//
// user_question_status 는 쓰기 정책이 없는 테이블이라 여기서만(service_role) 고친다.
async function respreadResumedSubject(
  supabase: Supabase,
  userId: string,
  subjectId: string,
  now: Date,
): Promise<void> {
  const nowIso = now.toISOString();

  // 연체된 내 문항 전부(과목 무관) → 그중 이 과목 것만 남긴다. 사용자가 응시한
  // 문제지 수는 과목 전체 문제지 수보다 훨씬 적어서 이쪽이 조회가 가볍다.
  type Row = Record<string, unknown> & {
    paper_id: string;
    question_number: number;
    srs_due_at: string;
  };
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("user_question_status")
      .select("*")
      .eq("user_id", userId)
      .not("srs_due_at", "is", null)
      .lte("srs_due_at", nowIso)
      .order("srs_due_at", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  if (rows.length === 0) return;

  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const subjectByPaper = new Map<string, string>();
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await supabase.from("exam_papers").select("id, subject_id").in("id", ids);
    for (const p of (data ?? []) as { id: string; subject_id: string }[]) {
      subjectByPaper.set(p.id, p.subject_id);
    }
  }

  // 연체가 오래된 것부터 먼저 되살린다(위 order 를 그대로 유지).
  const mine = rows.filter((r) => subjectByPaper.get(r.paper_id) === subjectId);
  if (mine.length === 0) return;

  const dueDates = spreadResumeDueDates(mine.length, now);
  const admin = createAdminClient();
  const updated = mine.map((r, i) => ({ ...r, srs_due_at: dueDates[i].toISOString() }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    await admin
      .from("user_question_status")
      .upsert(part, { onConflict: "user_id,paper_id,question_number" });
  }
}

export type SpreadBacklogResult = { error?: string; spreadCount?: number };

// "밀린 복습 정리하기" — 연체된 문항 전체를 오늘부터 며칠에 걸쳐 다시 뿌린다.
//
// 과목 재개 시 재예약(respreadResumedSubject)과 같은 규칙을 과목 구분 없이 돌리는
// 것이다. 필요한 이유도 같다: 연체가 수백 개면 예보 오늘 칸이 "412"로 굳고, 매일
// 20개를 풀어도 숫자가 안 줄어드는 것처럼 보여 사용자가 손을 놓는다. 문항이
// 사라지는 게 아니라 날짜만 흩어진다는 걸 화면에서도 그렇게 말해야 한다.
//
// 하루 몫은 상한의 절반으로 잡는다 — 밀린 것만으로 큐를 가득 채우면 신규 몫이 0이
// 돼서 대기 풀이 영영 안 줄어든다.
export async function spreadOverdueBacklog(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<SpreadBacklogResult> {
  const nowIso = now.toISOString();
  const { dailyLimit } = await getReviewPrefs(supabase, userId);

  type Row = Record<string, unknown> & { srs_due_at: string };
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("user_question_status")
      .select("*")
      .eq("user_id", userId)
      .not("srs_due_at", "is", null)
      .lte("srs_due_at", nowIso)
      .order("srs_due_at", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) return { error: "밀린 복습을 정리하지 못했어요." };
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  if (rows.length === 0) return { spreadCount: 0 };

  // 오래 연체된 것부터 앞날에 배치한다(위 order 유지).
  const dueDates = spreadResumeDueDates(rows.length, now, {
    perDay: Math.max(1, Math.floor(dailyLimit / 2)),
  });

  const admin = createAdminClient();
  const updated = rows.map((r, i) => ({ ...r, srs_due_at: dueDates[i].toISOString() }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    const { error } = await admin
      .from("user_question_status")
      .upsert(part, { onConflict: "user_id,paper_id,question_number" });
    if (error) return { error: "밀린 복습을 정리하지 못했어요." };
  }
  return { spreadCount: rows.length };
}

export type SetPausedResult = { error?: string; pausedSubjectIds?: string[] };

// 과목 하나를 보류하거나 다시 켠다. 재개일 때만 재예약이 붙는다.
export async function setSubjectPaused(
  supabase: Supabase,
  userId: string,
  subjectId: string,
  paused: boolean,
  now: Date = new Date(),
): Promise<SetPausedResult> {
  const current = await getPausedSubjectIds(supabase, userId);
  const wasPaused = current.has(subjectId);
  if (wasPaused === paused) return { pausedSubjectIds: [...current] };

  if (paused) current.add(subjectId);
  else current.delete(subjectId);

  const next = [...current];
  const { error } = await supabase
    .from("review_preferences")
    .upsert(
      { user_id: userId, paused_subject_ids: next, updated_at: now.toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return { error: "복습 과목 설정을 저장하지 못했어요." };

  // 저장이 끝난 뒤에 재예약한다. 재예약이 실패해도 설정 자체는 남는 편이 낫다 —
  // 그 경우 최악이 "재개 첫날 밀린 문항이 한꺼번에 뜬다"이고, 되돌리면 사용자는
  // 껐다 켠 게 아무 일도 안 일어난 것처럼 보인다.
  if (!paused) {
    try {
      await respreadResumedSubject(supabase, userId, subjectId, now);
    } catch {
      // 무시: 설정은 이미 저장됐다.
    }
  }

  return { pausedSubjectIds: next };
}
