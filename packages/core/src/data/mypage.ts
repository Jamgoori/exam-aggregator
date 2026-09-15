import type { SupabaseClient } from "@supabase/supabase-js";
import { representativePaperIds } from "../dedup-papers";
import { chunk } from "../format";
import { buildWrongNoteGroups, type WrongAnswerRow, type WrongNoteAttemptRow, type WrongNoteSubjectGroup } from "../wrong-notes";
import { currentCycleStartDate, isDiagnosisEligible } from "./home";
import { inParallel } from "./query-utils";
import { fetchWrongNoteMarks, REVIEW_COOLDOWN_HOURS } from "./wrong-notes";

// 마이페이지 집계(DI) — 웹 app/mypage/page.tsx 가 서버에서 하던 조회 중 사용자 세션(RLS
// select-own)으로 되는 것들을 옮긴 것(설계서 §5 `/mypage`, §6.8). 전부 본인 행만 읽는다:
// user_question_status·wrong_note_marks·cbt_attempt_answers·ai_diagnoses.
//
// 정답·해설·멤버십은 여기 없다(멤버십은 EF membership-get, 정답은 data/wrong-answers.ts).

// PostgREST 기본 최대 행 수 — range 로 이만큼씩 이어받는다.
const BATCH_SIZE = 1000;

// ── 남은 오답(과목별) — 웹 lib/wrong-notes.ts#getUnresolvedCountBySubject ──────────

export type UnresolvedBySubject = { id: string; name: string; slug: string; unresolved: number; due: number };

// 미극복 수는 user_question_status(CBT+섞어풀기 통합) 기준으로 센다 — 섞어풀기로 극복한 게
// 헤드라인·과목 카드에 즉시 반영되고, 섞어풀기 후보 수와 일치한다. 중복 시험지(같은 시험지를
// 직류만 다르게 올린 것)가 각각 응시됐어도 대표 문제지 기준으로 한 번만 센다.
// 결과는 배열(과목 id 포함) — Map 은 JSON 퍼시스트가 안 돼 앱 캐시에 그대로 못 넣는다.
export async function fetchUnresolvedCountBySubject(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<UnresolvedBySubject[]> {
  const dueCutoff = new Date(now.getTime() - REVIEW_COOLDOWN_HOURS * 3600 * 1000).toISOString();

  type StatusRow = { paper_id: string; question_number: number; last_is_correct: boolean; last_answered_at: string };
  const statusRows: StatusRow[] = [];
  {
    let from = 0;
    while (true) {
      const { data, error } = await client
        .from("user_question_status")
        .select("paper_id, question_number, last_is_correct, last_answered_at")
        .eq("user_id", userId)
        .gt("wrong_count", 0)
        .range(from, from + BATCH_SIZE - 1);
      if (error) throw new Error(`오답 집계 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      statusRows.push(...(data as StatusRow[]));
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }
  if (statusRows.length === 0) return [];

  const marks = await fetchWrongNoteMarks(client, userId);
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];

  // dedup 대표 계산 + 대표 문제지의 과목.
  type PaperMeta = {
    id: string;
    subject_id: string;
    exam_type_id: string;
    year: number;
    round: number;
    level: string | null;
    title: string;
    subjects: { id: string; name: string; slug: string } | null;
  };
  const papers: PaperMeta[] = [];
  await inParallel(chunk(paperIds, 100), async (ids) => {
    const { data } = await client
      .from("exam_papers")
      .select("id, subject_id, exam_type_id, year, round, level, title, subjects(id, name, slug)")
      .in("id", ids);
    for (const p of (data ?? []) as unknown as PaperMeta[]) papers.push(p);
  });
  const { repByPaperId } = representativePaperIds(papers);
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;
  const subjectOfPaper = new Map<string, { id: string; name: string; slug: string }>();
  for (const p of papers) if (p.subjects) subjectOfPaper.set(p.id, p.subjects);

  // 완전 삭제 마크를 대표 키로 정규화(드릴다운에서 실제 paper_id 로 찍혔을 수 있다).
  const deletedRepKeys = new Set<string>();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }

  // (대표, 문항)별로 가장 최근 상태만 남긴다.
  const byRepQ = new Map<string, { resolved: boolean; at: string; subjectId: string | null }>();
  for (const r of statusRows) {
    const rep = repId(r.paper_id);
    if (deletedRepKeys.has(`${rep}#${r.question_number}`)) continue;
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    const key = `${rep}#${r.question_number}`;
    const ex = byRepQ.get(key);
    if (!ex || r.last_answered_at > ex.at) {
      byRepQ.set(key, { resolved: r.last_is_correct, at: r.last_answered_at, subjectId: subj?.id ?? null });
    }
  }

  const nameSlug = new Map<string, { name: string; slug: string }>();
  for (const s of subjectOfPaper.values()) nameSlug.set(s.id, { name: s.name, slug: s.slug });

  const out = new Map<string, UnresolvedBySubject>();
  for (const v of byRepQ.values()) {
    if (v.resolved || !v.subjectId) continue;
    const meta = nameSlug.get(v.subjectId);
    if (!meta) continue;
    const e = out.get(v.subjectId) ?? { id: v.subjectId, name: meta.name, slug: meta.slug, unresolved: 0, due: 0 };
    e.unresolved++;
    if (v.at <= dueCutoff) e.due++;
    out.set(v.subjectId, e);
  }
  return [...out.values()];
}

// 마이페이지 "남은 오답" 합계 — 홈 배너(getMyUnresolvedTotal)와 같은 값.
export function sumUnresolved(bySubject: readonly UnresolvedBySubject[]): number {
  return bySubject.reduce((s, v) => s + v.unresolved, 0);
}

// ── 오답노트 과목 그룹(극복 진행률) — 웹 mypage/page.tsx 의 buildWrongNoteGroups 입력 조회 ──

// 응시들의 틀린 문항 행(cbt_attempt_answers, is_correct=false). 웹 lib/wrong-notes.ts#
// fetchWrongAnswerRows — 응시가 많은 사용자도 오답이 잘리지 않게 끝까지 이어받는다.
export async function fetchWrongAnswerRows(client: SupabaseClient, attemptIds: string[]): Promise<WrongAnswerRow[]> {
  const rows: WrongAnswerRow[] = [];
  await inParallel(chunk(attemptIds, 100), async (ids) => {
    let from = 0;
    while (true) {
      const { data, error } = await client
        .from("cbt_attempt_answers")
        .select("attempt_id, question_number, selected_choice")
        .in("attempt_id", ids)
        .eq("is_correct", false)
        .order("attempt_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (error) throw new Error(`오답 조회 실패: ${error.message}`);
      if (!data || data.length === 0) break;
      rows.push(...(data as WrongAnswerRow[]));
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  });
  return rows;
}

// buildWrongNoteGroups 용 statusOverrides(`${paperId}#${qnum}` → 극복 여부). 웹 lib/wrong-notes.ts#
// fetchQuestionStatusMap — 실제 paper_id 그대로(중복 시험지 접기 없이).
export async function fetchQuestionStatusMap(
  client: SupabaseClient,
  userId: string,
  paperIds: string[],
): Promise<Map<string, boolean>> {
  const latest = new Map<string, { correct: boolean; at: string }>();
  if (paperIds.length === 0) return new Map();
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await client
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; question_number: number; last_is_correct: boolean; last_answered_at: string }[]) {
      const key = `${row.paper_id}#${row.question_number}`;
      const ex = latest.get(key);
      if (!ex || row.last_answered_at > ex.at) latest.set(key, { correct: row.last_is_correct, at: row.last_answered_at });
    }
  });
  const out = new Map<string, boolean>();
  for (const [key, v] of latest) out.set(key, v.correct);
  return out;
}

// 응시 목록(이미 들고 있는 것)에서 과목별 오답노트 그룹을 만든다 — 웹 mypage/page.tsx 가
// premium 일 때만 돌리는 무거운 집계(문항별 오답 행 + 문항 상태 맵). 무료 회원에게는
// 부르지 않는다(과목 카드의 극복 진행률만 빠진다).
export async function fetchWrongNoteGroupsForAttempts(
  client: SupabaseClient,
  userId: string,
  attempts: WrongNoteAttemptRow[],
): Promise<WrongNoteSubjectGroup[]> {
  if (attempts.length === 0) return [];
  const paperIds = [...new Set(attempts.map((a) => a.exam_papers?.id).filter((id): id is string => !!id))];
  const [wrongRows, marks, overrides] = await Promise.all([
    fetchWrongAnswerRows(
      client,
      attempts.map((a) => a.id),
    ),
    fetchWrongNoteMarks(client, userId),
    fetchQuestionStatusMap(client, userId, paperIds),
  ]);
  return buildWrongNoteGroups(attempts, wrongRows, marks.deleted, overrides);
}

// ── AI 약점 진단 자격·이번 주기 상태 — 웹 lib/ai-diagnosis.ts ─────────────────────
// (주기 상수·경계 계산은 data/home.ts — 홈 스트림과 공유.)

export type DiagnosisEligibility = {
  eligible: boolean;
  wrongCount: number;
  attemptCount: number;
};

// 응시 수 + 한 번이라도 틀린 문항 수(user_question_status). 둘 다 count 조회라 가볍다.
export async function fetchDiagnosisEligibility(client: SupabaseClient, userId: string): Promise<DiagnosisEligibility> {
  const [{ count: attemptCount }, { count: wrongCount }] = await Promise.all([
    client.from("cbt_attempts").select("id", { count: "exact", head: true }).eq("user_id", userId),
    client.from("user_question_status").select("paper_id", { count: "exact", head: true }).eq("user_id", userId).gt("wrong_count", 0),
  ]);
  const counts = { attemptCount: attemptCount ?? 0, wrongCount: wrongCount ?? 0 };
  return { eligible: isDiagnosisEligible(counts), ...counts };
}

export type WeeklyDiagnosisStatus = "ready" | "pending";

// 현재 주기 안의 진단 행 상태(웹 getWeeklyDiagnosis 의 status 부분). report 가 있으면 ready,
// 요청만 있으면 pending, 없으면 null. ai_diagnoses 는 select-own RLS — 리포트 본문은 앱 캐시에
// 남기지 않도록 여기서 상태만 뽑는다(설계서 §6.5 진단 리포트 본문은 메모리 전용).
export async function fetchWeeklyDiagnosisStatus(
  client: SupabaseClient,
  userId: string,
  now: Date = new Date(),
): Promise<WeeklyDiagnosisStatus | null> {
  const { data } = await client
    .from("ai_diagnoses")
    .select("diagnosis_date, report")
    .eq("user_id", userId)
    .gte("diagnosis_date", currentCycleStartDate(now))
    .order("diagnosis_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return (data as { report: unknown }).report ? "ready" : "pending";
}
