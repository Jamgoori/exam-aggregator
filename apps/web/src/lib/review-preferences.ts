import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizeDailyLimit,
  spreadResumeDueDates,
  DAILY_LIMIT_OPTIONS,
  type StudyPhase,
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
//
// 여기에 study_phase를 끼워 넣지 않는다. PostgREST는 없는 컬럼을 고르면 쿼리
// 전체를 거절하는데, 이 함수는 error를 삼키고 기본값을 돌려주므로 마이그레이션
// 적용 전에는 기존 사용자의 과목 보류와 하루 상한이 조용히 초기화된 것처럼
// 보이게 된다. 국면은 없어도 되는 파생값이라 따로 읽는다(getStoredStudyPhase).
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

// AI 약점 진단에서 뺄 과목. 복습 보류와 목적이 달라 컬럼이 따로다(schema.sql 참고).
// 맞춤 극복법은 개념 하나당 실API 생성이 붙어 요금이 개념 수에 비례하므로 과목당 7개·
// 전체 15개 상한이 있다. 준비하지 않는 과목이 그 자리를 차지하면 정작 필요한 과목이
// 얕아지므로 사용자가 직접 뺀다.
//
// 마이그레이션 전이면 컬럼이 없어 조회가 실패한다 — 그때는 "아무것도 안 뺐다"로 본다
// (진단이 통째로 막히는 것보다 낫다).
export async function getDiagnosisPausedSubjectIds(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase
    .from("review_preferences")
    .select("diagnosis_paused_subject_ids")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return new Set();
  return new Set(((data?.diagnosis_paused_subject_ids ?? []) as string[]).filter(Boolean));
}

// 진단에서 뺀 과목의 slug 집합. 생성기는 slug 축으로 개념을 묶으므로 id → slug 로
// 한 번 바꿔서 넘긴다. 뺀 과목이 없으면 조회 없이 빈 집합.
export async function getExcludedDiagnosisSubjectSlugs(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  const ids = await getDiagnosisPausedSubjectIds(supabase, userId);
  if (ids.size === 0) return new Set();
  const { data } = await supabase.from("subjects").select("id, slug").in("id", [...ids]);
  return new Set(((data ?? []) as { slug: string }[]).map((r) => r.slug).filter(Boolean));
}

export type SetDiagnosisSubjectResult = { error?: string; pausedSubjectIds?: string[] };

// 과목 하나를 진단에서 빼거나 다시 넣는다. 복습 쪽 setSubjectPaused 와 달리 재예약 같은
// 후속 작업이 없어 저장만 하면 된다.
export async function setDiagnosisSubjectPaused(
  supabase: Supabase,
  userId: string,
  subjectId: string,
  paused: boolean,
  now: Date = new Date(),
): Promise<SetDiagnosisSubjectResult> {
  const current = await getDiagnosisPausedSubjectIds(supabase, userId);
  if (current.has(subjectId) === paused) return { pausedSubjectIds: [...current] };

  if (paused) current.add(subjectId);
  else current.delete(subjectId);

  const next = [...current];
  const { error } = await supabase
    .from("review_preferences")
    .upsert(
      { user_id: userId, diagnosis_paused_subject_ids: next, updated_at: now.toISOString() },
      { onConflict: "user_id" },
    );
  if (error) return { error: "진단 과목 설정을 저장하지 못했어요." };
  return { pausedSubjectIds: next };
}

// 직전에 판정된 학습 국면(히스테리시스의 입력). 마이그레이션 전이거나 값이
// 이상하면 null — 첫 판정으로 처리되고 다음 저장에서 채워진다.
export async function getStoredStudyPhase(
  supabase: Supabase,
  userId: string,
): Promise<StudyPhase | null> {
  const { data } = await supabase
    .from("review_preferences")
    .select("study_phase")
    .eq("user_id", userId)
    .maybeSingle();
  const phase = data?.study_phase as string | null | undefined;
  return phase === "expanding" || phase === "settling" ? phase : null;
}

// 국면이 바뀐 순간에만 부른다(읽을 때마다 쓰지 않는다). 파생값이라 실패해도
// 화면은 계산된 국면 그대로 그린다 — 다음 방문에서 다시 시도된다.
export async function saveStudyPhase(
  supabase: Supabase,
  userId: string,
  phase: StudyPhase,
  now: Date = new Date(),
): Promise<void> {
  await supabase.from("review_preferences").upsert(
    {
      user_id: userId,
      study_phase: phase,
      study_phase_at: now.toISOString(),
      updated_at: now.toISOString(),
    },
    { onConflict: "user_id" },
  );
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
      .is("srs_suspended_at", null)
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
      // 접어둔 문항은 큐에 없으므로 밀린 것으로도 세지 않고 다시 뿌리지도 않는다.
      .is("srs_suspended_at", null)
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
      // 접어둔 문항은 큐에 없으므로 밀린 것으로도 세지 않고 다시 뿌리지도 않는다.
      .is("srs_suspended_at", null)
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

export type RestoreSuspendedResult = { error?: string; restoredCount?: number };

// 접어둔(leech) 문항을 다시 복습에 넣는다.
//
// lapses는 그대로 둔다 — 진도를 잃지 않게 하려는 것이고, 덕분에 네 번 더 무너지면
// 다시 접힌다(8 → 12 → 16, Anki와 같은 재판정 간격).
//
// 한꺼번에 되살리면 그 문항들이 전부 연체 상태라 다음날 큐를 통째로 먹는다. 게다가
// 우선순위 점수가 lapses에 비례해서(leech는 8 이상) 다른 문항이 몇 주째 안 나온다.
// 그래서 과목 재개와 같은 규칙으로 며칠에 걸쳐 나눠 예약한다.
export async function restoreSuspendedQuestions(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<RestoreSuspendedResult> {
  const { dailyLimit } = await getReviewPrefs(supabase, userId);

  type Row = Record<string, unknown>;
  const rows: Row[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("user_question_status")
      .select("*")
      .eq("user_id", userId)
      .not("srs_suspended_at", "is", null)
      .order("srs_suspended_at", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    if (error) return { error: "접어둔 문제를 되살리지 못했어요." };
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  if (rows.length === 0) return { restoredCount: 0 };

  // 하루 몫을 상한의 1/4로 잡는다. leech는 점수가 높아 큐 앞자리를 차지하므로,
  // 재개 과목(절반)보다 더 얇게 흘려보내야 나머지 복습이 안 밀린다.
  const dueDates = spreadResumeDueDates(rows.length, now, {
    perDay: Math.max(1, Math.floor(dailyLimit / 4)),
  });

  const admin = createAdminClient();
  const updated = rows.map((r, i) => ({
    ...r,
    srs_suspended_at: null,
    srs_due_at: dueDates[i].toISOString(),
  }));
  for (const part of chunk(updated, UPSERT_CHUNK)) {
    const { error } = await admin
      .from("user_question_status")
      .upsert(part, { onConflict: "user_id,paper_id,question_number" });
    if (error) return { error: "접어둔 문제를 되살리지 못했어요." };
  }
  return { restoredCount: rows.length };
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
