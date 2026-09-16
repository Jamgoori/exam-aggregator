import {
  applyExamTypeSubjectName,
  buildWrongNoteGroups,
  chunk,
  collidingPaperIds,
  fetchPaperIdentitySignalsRpc,
  fetchQuestionMedia,
  fetchUnresolvedCountBySubject,
  fetchWrongAnswerRows,
  fetchWrongNoteGroupsForAttempts,
  isReviewHistoryList,
  representativePaperIds,
  stripTrackFromTitle,
  sumUnresolved,
  WRONGRATE_MIN_SAMPLE,
  type DedupablePaper,
  type MyAttemptRow,
  type ReviewHistoryMixNote,
  type ReviewItemRequestRef,
  type ReviewPickStrategy,
  type Subject,
  type UnresolvedBySubject,
  type WrongNoteAttemptRow,
  type WrongNotePaperGroup,
  type WrongNotePaperInfo,
  type WrongNoteQuestionSummary,
  type WrongNoteSubjectGroup,
} from "@gongmoa/core";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import * as Crypto from "expo-crypto";
import { useMemo, useRef } from "react";
import { callEdge } from "../lib/edge";
import { STALE } from "../lib/query-client";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/auth-provider";

// 오답노트 집계(설계서 §6.2 오답노트 행 — RLS 직접, 30초, 퍼시스트). 키 접두 ['me', u, 'wrong-notes']
// 는 채점 성공(queries/cbt.ts·queries/review.ts)이 통째로 무효화한다(아래 뮤테이션은 아니다 —
// "뮤테이션(메모·다시 볼 문제·삭제·복구)" 절 머리말).
// 정답(RPC own_wrong_answers)은 queries/attempts.ts 의 메모리 전용 쿼리, 해설은 queries/explanations.ts
// 의 wrong-note 모드 — 둘 다 여기 섞지 않는다(디스크 퍼시스트 금지선).
//
// 웹 lib/wrong-notes.ts 는 service_role 로 정답·해설까지 한 번에 붙여 내려주지만 앱은 그 경로가
// 없다. 그래서 이 파일은 **RLS 로 읽을 수 있는 것**(응시·오답 행·문항 상태·마크·메모·문항 이미지)
// 만 모아 표시용 골격을 만들고, 정답·해설은 화면에서 따로 받은 쿼리와 합친다(웹과 같은 화면).

export const unresolvedBySubjectKey = (userId: string) => ["me", userId, "wrong-notes", "unresolved-by-subject"] as const;
export const wrongNoteGroupsKey = (userId: string, attemptsSig: string) =>
  ["me", userId, "wrong-notes", "groups", attemptsSig] as const;
export const subjectPapersKey = (userId: string, subjectId: string) =>
  ["me", userId, "wrong-notes", "subject-papers", subjectId] as const;
export const subjectQuestionsKey = (userId: string, subjectId: string) =>
  ["me", userId, "wrong-notes", "subject-questions", subjectId] as const;
export const paperWrongNoteKey = (userId: string, paperId: string) =>
  ["me", userId, "wrong-notes", "paper", paperId] as const;
export const mixNoteKey = (userId: string, sessionId: string) =>
  ["edge", "review-history", "mix-note", sessionId, userId] as const;

// 과목별 남은 오답(user_question_status 기준, 삭제 마크 제외). 무료 회원에게도 계산한다 —
// 상단 "남은 오답" 타일과 무료 회원 오답노트 탭의 과목 카드가 전부 이 값으로 그려진다.
export function useUnresolvedBySubject() {
  const { userId } = useAuth();
  const query = useQuery<UnresolvedBySubject[]>({
    queryKey: unresolvedBySubjectKey(userId ?? ""),
    queryFn: () => fetchUnresolvedCountBySubject(supabase, userId!),
    enabled: !!userId,
    staleTime: STALE.me,
  });
  const total = useMemo(() => (query.data ? sumUnresolved(query.data) : 0), [query.data]);
  return { query, total };
}

// 과목 → 문제지 → 문항 그룹(극복 진행률). 웹처럼 프리미엄에게만 돌린다(무거운 집계) — enabled=false
// 면 과목 카드는 남은 오답만 그린다. 응시 목록이 바뀌면(id·수) 키가 바뀌어 다시 센다.
export function useWrongNoteGroups(attempts: MyAttemptRow[] | undefined, enabled: boolean) {
  const { userId } = useAuth();
  const sig = useMemo(() => (attempts ?? []).map((a) => a.id).join(","), [attempts]);
  return useQuery<WrongNoteSubjectGroup[]>({
    queryKey: wrongNoteGroupsKey(userId ?? "", sig),
    queryFn: () => fetchWrongNoteGroupsForAttempts(supabase, userId!, attempts ?? []),
    enabled: !!userId && enabled && !!attempts,
    staleTime: STALE.me,
  });
}

// ── 과목 오답노트 공통 조회 ────────────────────────────────────────────────────

// 웹 lib/wrong-notes.ts 의 ATTEMPT_SELECT + dedup 계산용 필드(SUBJECT_ATTEMPT_SELECT 와 같은 조합).
const SUBJECT_ATTEMPT_SELECT =
  "id, created_at, score, total_questions, exam_papers!inner(id, title, level, round, track, choice_count, subject_id, exam_type_id, year, created_at, subjects(*), exam_types(*))";

type AttemptPaperRow = WrongNotePaperInfo & DedupablePaper;
type SubjectAttemptRow = {
  id: string;
  created_at: string;
  score: number;
  total_questions: number;
  exam_papers: AttemptPaperRow | null;
};

// 이 과목 문제지에 대한 내 응시(최신순). exam_papers 임베드 FK 로 과목을 건다(RLS: 본인 행만).
async function fetchSubjectAttempts(
  client: SupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SubjectAttemptRow[]> {
  const { data, error } = await client
    .from("cbt_attempts")
    .select(SUBJECT_ATTEMPT_SELECT)
    .eq("user_id", userId)
    .eq("exam_papers.subject_id", subjectId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`오답노트 조회 실패: ${error.message}`);
  return ((data ?? []) as unknown as SubjectAttemptRow[]).filter((a) => a.exam_papers);
}

// 삭제·다시 볼 문제 마크(웹 core data/wrong-notes.ts fetchWrongNoteMarks 와 같은 조회 — 그 함수는
// @gongmoa/core/server 에만 있어 앱이 import 할 수 없다(금지선). Set 은 퍼시스트가 안 되므로
// 화면·집계가 그대로 쓰는 문자열 배열(`${paperId}#${qnum}`)로 돌려준다.
export type WrongNoteMarkKeys = { deleted: string[]; pinned: string[] };

async function fetchMarkKeys(
  client: SupabaseClient,
  userId: string,
  paperIds?: string[],
): Promise<WrongNoteMarkKeys> {
  const deleted: string[] = [];
  const pinned: string[] = [];
  if (paperIds && paperIds.length === 0) return { deleted, pinned };
  const idChunks: (string[] | null)[] = paperIds ? chunk(paperIds, 200) : [null];
  for (const ids of idChunks) {
    let query = client
      .from("wrong_note_marks")
      .select("paper_id, question_number, pinned, deleted")
      .eq("user_id", userId);
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    // 한 청크라도 실패하면 마크를 부분 적용하지 않는다(삭제 마크가 빠지면 지운 문항이 되살아난다).
    if (error) return { deleted: [], pinned: [] };
    for (const r of (data ?? []) as { paper_id: string; question_number: number; pinned: boolean | null; deleted: boolean | null }[]) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (r.deleted) deleted.push(key);
      if (r.pinned) pinned.push(key);
    }
  }
  return { deleted, pinned };
}

// 문항 메모(본인 것만, RLS). `${paperId}#${qnum}` → 메모.
async function fetchMemoMap(
  client: SupabaseClient,
  userId: string,
  paperIds: string[],
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 200)) {
    const { data } = await client
      .from("question_memos")
      .select("paper_id, question_number, memo")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of (data ?? []) as { paper_id: string; question_number: number; memo: string | null }[]) {
      const memo = r.memo?.trim();
      if (memo) out[`${r.paper_id}#${r.question_number}`] = memo;
    }
  }
  return out;
}

// 전국 오답률(%) — RPC paper_question_wrong_rates(security definer, **authenticated 전용**,
// schema.sql:939). 표본이 WRONGRATE_MIN_SAMPLE 미만이면 넣지 않는다(작은 표본은 오해를 준다).
// 함수가 아직 적용 안 된 환경에서는 배지 없이 넘어간다(웹과 같은 폴백).
async function fetchWrongRates(client: SupabaseClient, paperIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 50)) {
    const { data, error } = await client.rpc("paper_question_wrong_rates", { p_paper_ids: ids });
    if (error) return out;
    for (const r of (data ?? []) as { paper_id: string; question_number: number; attempts: number; wrongs: number }[]) {
      if (Number(r.attempts) < WRONGRATE_MIN_SAMPLE) continue;
      out[`${r.paper_id}#${r.question_number}`] = Math.round((Number(r.wrongs) / Number(r.attempts)) * 100);
    }
  }
  return out;
}

// 문항별 통합 상태(user_question_status)를 대표 문제지+문항 키로 접어 받아온다. 중복 시험지는
// 실제 paper_id 별로 상태가 흩어질 수 있어 같은 대표+문항 중 가장 최근 것을 쓴다(RLS: 본인 행만).
async function fetchStatusByRep(
  client: SupabaseClient,
  userId: string,
  realPaperIds: string[],
  repId: (paperId: string) => string,
): Promise<Record<string, boolean>> {
  const latest = new Map<string, { correct: boolean; at: string }>();
  if (realPaperIds.length === 0) return {};
  for (const ids of chunk(realPaperIds, 200)) {
    const { data } = await client
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; question_number: number; last_is_correct: boolean; last_answered_at: string }[]) {
      const key = `${repId(row.paper_id)}#${row.question_number}`;
      const ex = latest.get(key);
      if (!ex || row.last_answered_at > ex.at) latest.set(key, { correct: row.last_is_correct, at: row.last_answered_at });
    }
  }
  const out: Record<string, boolean> = {};
  for (const [key, v] of latest) out[key] = v.correct;
  return out;
}

// ── 과목 오답노트 "시험지별" ───────────────────────────────────────────────────

// 웹 getSubjectWrongNoteOverview 와 같은 값(응시 → buildWrongNoteGroups). 과목이 없으면 빈 배열.
export function useSubjectWrongNotePapers(subject: Subject | null | undefined) {
  const { userId } = useAuth();
  const subjectId = subject?.id ?? "";
  return useQuery<WrongNotePaperGroup[]>({
    queryKey: subjectPapersKey(userId ?? "", subjectId),
    queryFn: async () => {
      const attempts = await fetchSubjectAttempts(supabase, userId!, subjectId);
      if (attempts.length === 0) return [];
      const groups = await fetchWrongNoteGroupsForAttempts(
        supabase,
        userId!,
        attempts as unknown as WrongNoteAttemptRow[],
      );
      return groups.find((g) => g.subject.id === subjectId)?.papers ?? [];
    },
    enabled: !!userId && !!subjectId,
    staleTime: STALE.me,
  });
}

// ── 과목 오답노트 "문제만 모아보기" ────────────────────────────────────────────

// 웹 SubjectWrongNoteQuestion 에서 정답·해설을 뺀 모양. 정답(own_wrong_answers)과 해설
// (explanations-get context:"wrong-note")은 화면이 메모리 전용 쿼리로 따로 받아 합친다.
export type SubjectWrongNoteQuestion = {
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  questionNumber: number;
  wrongCount: number;
  resolved: boolean;
  selectedChoice: number | null;
  lastWrongAt: string;
  choiceCount: number;
  images: string[];
  memo: string | null;
  wrongRatePct: number | null;
  pinned: boolean;
};

export type SubjectWrongNoteQuestions = {
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
  resolvedCount: number;
};

// 웹 getSubjectWrongNoteQuestions 1:1(정답·해설 제외). 중복 시험지(직류만 다른 같은 시험지)는
// dedup 대표로 접어 문항을 합친다 — 표시 통합과 같은 기준.
//
// **응시 없이 채점된 오답**(기출 섞어풀기·같은개념 기출)은 아직 합산하지 않는다: 웹은 그 문항이
// 마지막에 고른 답을 review_session_items 에서 되짚는데(fetchLastReviewChoices) 그 테이블은 RLS
// 정책이 하나도 없어 앱이 읽을 수 없다. 설계서 §12 Phase 3 "상태 전용 오답 합산" 항목.
async function fetchSubjectWrongNoteQuestions(
  client: SupabaseClient,
  userId: string,
  subjectId: string,
): Promise<SubjectWrongNoteQuestions> {
  const attempts = await fetchSubjectAttempts(client, userId, subjectId);
  if (attempts.length === 0) return { questions: [], unresolvedCount: 0, resolvedCount: 0 };

  const distinctPapers = new Map<string, AttemptPaperRow>();
  for (const a of attempts) {
    const p = a.exam_papers!;
    if (!distinctPapers.has(p.id)) distinctPapers.set(p.id, p);
  }
  const paperList = [...distinctPapers.values()];

  // 겹칠 수 있는 문제지가 있을 때만 정답 지문 신호를 묻는다(RPC paper_identity_signals).
  //
  // core fetchPaperIdentitySignalsRpc 는 RPC 실패를 던진다(형제인 fetchWrongRates 는 배지 없이
  // 넘어간다) — 그대로 두면 RPC 가 아직 배포 안 됐거나 권한이 막힌 환경에서 "문제만 모아보기"
  // 탭 전체가 오류 화면이 된다. 신호는 **중복 시험지 판정 정확도**에만 쓰이고 없으면
  // representativePaperIds 가 메타데이터만으로 접는 폴백(signals?: 선택 인자)이 이미 있으므로,
  // 부르는 쪽에서 undefined 로 떨어뜨린다(core 는 건드리지 않는다).
  const signals =
    collidingPaperIds(paperList).length > 0
      ? await fetchPaperIdentitySignalsRpc(client, paperList).catch(() => undefined)
      : undefined;
  const { repByPaperId, finalGroupSizeByRepId } = representativePaperIds(paperList, signals);
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;

  // 대표 문제지 표시 정보. 실제로 합쳐진(2건 이상) 대표는 title 에서 track 접미사를 뗀다.
  const repInfo = new Map<string, { title: string; level: string | null; choiceCount: number }>();
  for (const p of paperList) {
    if (repId(p.id) !== p.id) continue;
    const collapsed = (finalGroupSizeByRepId.get(p.id) ?? 1) > 1;
    repInfo.set(p.id, {
      title: applyExamTypeSubjectName(collapsed && p.track ? stripTrackFromTitle(p.title, p.track) : p.title),
      level: p.level,
      choiceCount: p.choice_count,
    });
  }

  const wrongRows = await fetchWrongAnswerRows(client, attempts.map((a) => a.id));
  const wrongByAttempt = new Map<string, { question_number: number; selected_choice: number | null }[]>();
  for (const row of wrongRows) {
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    wrongByAttempt.set(row.attempt_id, list);
  }

  // 대표별 "가장 최근 응시" = 최신순 attempts 에서 처음 만나는 것. 그 응시에서 틀리지 않았으면 극복.
  const latestAttemptIdByRep = new Map<string, string>();
  for (const a of attempts) {
    const r = repId(a.exam_papers!.id);
    if (!latestAttemptIdByRep.has(r)) latestAttemptIdByRep.set(r, a.id);
  }
  const wrongInLatestByRep = new Map<string, Set<number>>();
  for (const [r, attemptId] of latestAttemptIdByRep) {
    wrongInLatestByRep.set(r, new Set((wrongByAttempt.get(attemptId) ?? []).map((w) => w.question_number)));
  }

  // (대표 문제지, 문항 번호)로 오답을 합친다. 최신순으로 훑으므로 처음 만든 값이 "가장 최근에
  // 고른 답 / 가장 최근에 틀린 시각"이 된다.
  type Agg = { repId: string; questionNumber: number; wrongCount: number; selectedChoice: number | null; lastWrongAt: string };
  const byRepQ = new Map<string, Agg>();
  for (const a of attempts) {
    const r = repId(a.exam_papers!.id);
    for (const row of wrongByAttempt.get(a.id) ?? []) {
      const key = `${r}#${row.question_number}`;
      const existing = byRepQ.get(key);
      if (existing) existing.wrongCount++;
      else {
        byRepQ.set(key, {
          repId: r,
          questionNumber: row.question_number,
          wrongCount: 1,
          selectedChoice: row.selected_choice,
          lastWrongAt: a.created_at,
        });
      }
    }
  }

  const repIds = [...repInfo.keys()];
  // 화면에 실제로 그릴 (대표 문제지, 문항 번호)만 이미지 조회 대상으로 넘긴다.
  const wantedNumbers = new Map<string, Set<number>>();
  for (const agg of byRepQ.values()) {
    const set = wantedNumbers.get(agg.repId) ?? new Set<number>();
    set.add(agg.questionNumber);
    wantedNumbers.set(agg.repId, set);
  }

  const realPaperIds = paperList.map((p) => p.id);
  const [mediaByPaper, statusByRepQ, memoByRepQ, rateByRepQ, rawMarks] = await Promise.all([
    fetchQuestionMedia(client, repIds, wantedNumbers),
    fetchStatusByRep(client, userId, realPaperIds, repId),
    fetchMemoMap(client, userId, repIds),
    fetchWrongRates(client, repIds),
    fetchMarkKeys(client, userId, realPaperIds),
  ]);

  // 마크는 실제 paper_id 로 저장돼 있을 수 있어(문제지 드릴다운에서 찍은 것) 대표 키로 정규화한다.
  const toRepKey = (k: string) => {
    const idx = k.lastIndexOf("#");
    return `${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`;
  };
  const deletedRepKeys = new Set(rawMarks.deleted.map(toRepKey));
  const pinnedRepKeys = new Set(rawMarks.pinned.map(toRepKey));

  const questions: SubjectWrongNoteQuestion[] = [];
  for (const agg of byRepQ.values()) {
    const key = `${agg.repId}#${agg.questionNumber}`;
    if (deletedRepKeys.has(key)) continue;
    const info = repInfo.get(agg.repId);
    if (!info) continue;
    const media = mediaByPaper.get(agg.repId)?.get(agg.questionNumber);
    // 극복 판정: 통합 상태(CBT+섞어풀기 최신 결과) 우선, 없으면 CBT 최신 응시 기준 폴백.
    const status = statusByRepQ[key];
    questions.push({
      paperId: agg.repId,
      paperTitle: info.title,
      paperLevel: info.level,
      questionNumber: agg.questionNumber,
      wrongCount: agg.wrongCount,
      resolved: status ?? !wrongInLatestByRep.get(agg.repId)?.has(agg.questionNumber),
      selectedChoice: agg.selectedChoice,
      lastWrongAt: agg.lastWrongAt,
      choiceCount: media?.choiceCount ?? info.choiceCount,
      images: media?.images ?? [],
      memo: memoByRepQ[key] ?? null,
      wrongRatePct: rateByRepQ[key] ?? null,
      pinned: pinnedRepKeys.has(key),
    });
  }

  // 세트문제 병합이 성립하도록 (제목, 번호) 순 안정 정렬. 화면이 다시 정렬한다.
  questions.sort((a, b) => a.paperTitle.localeCompare(b.paperTitle, "ko") || a.questionNumber - b.questionNumber);
  const unresolvedCount = questions.filter((q) => !q.resolved).length;
  return { questions, unresolvedCount, resolvedCount: questions.length - unresolvedCount };
}

export function useSubjectWrongNoteQuestions(subject: Subject | null | undefined) {
  const { userId } = useAuth();
  const subjectId = subject?.id ?? "";
  return useQuery<SubjectWrongNoteQuestions>({
    queryKey: subjectQuestionsKey(userId ?? "", subjectId),
    queryFn: () => fetchSubjectWrongNoteQuestions(supabase, userId!, subjectId),
    enabled: !!userId && !!subjectId,
    staleTime: STALE.me,
  });
}

// ── 문제지 오답노트(과목 → 문제지 드릴다운) ────────────────────────────────────

export type PaperWrongNoteRound = {
  attemptId: string;
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
  wrong: { questionNumber: number; selectedChoice: number | null }[];
};

export type PaperWrongNoteQuestion = WrongNoteQuestionSummary & {
  choiceCount: number;
  images: string[];
  pinned: boolean;
};

export type PaperWrongNote = {
  paper: WrongNotePaperInfo;
  rounds: PaperWrongNoteRound[];
  questions: PaperWrongNoteQuestion[];
  unresolvedCount: number;
  resolvedCount: number;
};

const PAPER_ATTEMPT_SELECT =
  "id, created_at, score, total_questions, exam_papers(id, title, level, round, track, choice_count, subjects(*), exam_types(*))";

// 웹 getPaperWrongNote 1:1(정답·해설 제외 — 화면이 따로 받는다). 응시 기록이 없거나 문제지가
// 삭제됐으면 null(화면은 404).
async function fetchPaperWrongNote(
  client: SupabaseClient,
  userId: string,
  paperId: string,
): Promise<PaperWrongNote | null> {
  const { data } = await client
    .from("cbt_attempts")
    .select(PAPER_ATTEMPT_SELECT)
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  const attempts = (data ?? []) as unknown as WrongNoteAttemptRow[];
  const paper = attempts.find((a) => a.exam_papers)?.exam_papers;
  if (!paper) return null;

  const [wrongRows, marks, statusRaw] = await Promise.all([
    fetchWrongAnswerRows(client, attempts.map((a) => a.id)),
    fetchMarkKeys(client, userId, [paperId]),
    fetchStatusByRep(client, userId, [paperId], (id) => id),
  ]);

  const wrongByAttempt = new Map<string, PaperWrongNoteRound["wrong"]>();
  for (const row of wrongRows) {
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push({ questionNumber: row.question_number, selectedChoice: row.selected_choice });
    wrongByAttempt.set(row.attempt_id, list);
  }
  const rounds: PaperWrongNoteRound[] = attempts.map((a, i) => ({
    attemptId: a.id,
    round: i + 1,
    score: a.score ?? 0,
    totalQuestions: a.total_questions ?? 0,
    createdAt: a.created_at,
    wrong: wrongByAttempt.get(a.id) ?? [],
  }));

  const statusOverrides = new Map(Object.entries(statusRaw));
  // 오답이 하나도 없으면(전부 만점) 통합 목록은 비지만 회독 기록은 그대로 보여준다.
  const group = buildWrongNoteGroups(attempts, wrongRows, new Set(marks.deleted), statusOverrides)[0]?.papers[0];
  if (!group) return { paper, rounds, questions: [], unresolvedCount: 0, resolvedCount: 0 };

  const media = (await fetchQuestionMedia(client, [paper.id])).get(paper.id);
  const pinned = new Set(marks.pinned);
  return {
    paper,
    rounds,
    questions: group.questions.map((q) => {
      const entry = media?.get(q.questionNumber);
      return {
        ...q,
        choiceCount: entry?.choiceCount ?? paper.choice_count,
        images: entry?.images ?? [],
        pinned: pinned.has(`${paper.id}#${q.questionNumber}`),
      };
    }),
    unresolvedCount: group.unresolvedCount,
    resolvedCount: group.resolvedCount,
  };
}

export function usePaperWrongNote(paperId: string | null) {
  const { userId } = useAuth();
  return useQuery<PaperWrongNote | null>({
    queryKey: paperWrongNoteKey(userId ?? "", paperId ?? ""),
    queryFn: () => fetchPaperWrongNote(supabase, userId!, paperId!),
    enabled: !!userId && !!paperId,
    staleTime: STALE.me,
  });
}

// ── mix 기록(기출 섞어풀기 한 세션의 오답노트) ─────────────────────────────────

// EF review-history { sessionId, view: "mix-note" }(§6.7 #10). 정답·해설 본문이 실리므로
// **메모리 전용**(meta.persist:false, gcTime 0 — §6.5, AGENTS.md 금지선).
//
// 이미 끝난 세션의 기록이라 화면을 열어 둔 동안에는 서버에서 바뀌지 않는다. 기본 정책
// (staleTime 0 + 포커스·재접속 재조회)이면 앱을 잠깐 나갔다 오는 것만으로 서버가 buildMixPool
// 을 다시 돌린다 — 복습 세션 화면(queries/review.ts useReviewSession)과 같은 이유로 막는다.
// gcTime 0 이라 화면을 나가면 어차피 버려지므로 "다시 들어오면 새로 받는다"는 그대로다.
export function useMixSessionNote(sessionId: string | null) {
  const { userId } = useAuth();
  return useQuery<ReviewHistoryMixNote>({
    queryKey: mixNoteKey(userId ?? "", sessionId ?? ""),
    queryFn: async () => {
      const res = await callEdge("review-history", { sessionId: sessionId!, view: "mix-note" });
      if (isReviewHistoryList(res) || !res.mixNote) throw new Error("세션을 찾을 수 없어요.");
      return res.mixNote;
    },
    enabled: !!userId && !!sessionId,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
    meta: { persist: false },
  });
}

// ── 뮤테이션(메모·다시 볼 문제·삭제·복구) ──────────────────────────────────────
//
// 전부 RLS 직접 쓰기(웹 서버 액션 saveQuestionMemo·setQuestionPinned·deleteWrongNoteQuestion·
// restoreWrongNoteQuestion 과 같은 upsert). 화면은 낙관적으로 먼저 바꾸고 실패하면 되돌린다
// (설계서 §4.5 #19 "낙관적 업데이트(onMutate)").
//
// **무효화는 화면이 스스로 못 고치는 값에만 건다.** 다시 볼 문제(pinned)·메모는 세 화면
// (subject-wrong-note-questions.tsx `pinnedKeys`, wrong-note-paper-view.tsx `pinnedNumbers`,
// mix-session-view.tsx `pinnedKeys`, memo-editor.tsx `memo`)이 전부 로컬 상태로 들고 즉시
// 반영하므로, 여기서 `['me', u, 'wrong-notes']` 를 통째로 무효화하면 **열려 있는 화면의**
// 10~20 왕복짜리 집계(fetchSubjectWrongNoteQuestions 등)만 다시 돌 뿐 화면은 한 픽셀도
// 바뀌지 않는다(게다가 그 응답이 돌아와도 pinned/memo 는 마운트 때 한 번만 읽는 초기값이라
// 무시된다). 그래서 핀·메모는 무효화하지 않는다.
//
// 삭제·복구는 다르다: 남은 오답 수(`unresolved-by-subject`)는 화면 밖(마이페이지 타일·오답노트
// 탭·학습 리마인더 §7.1)에서 읽히고 로컬로 고칠 수 없다. 다만 목록 자체는 `deletedKeys` 가
// 이미 감추고 `visibleUnresolved` 가 숫자까지 빼 두므로, 무거운 집계 키까지 건드리지 않고
// **남은 오답 수 키 하나만** 무효화한다.

const MEMO_MAX = 2000;

function invalidateUnresolvedCount(queryClient: QueryClient, userId: string | null) {
  if (!userId) return;
  void queryClient.invalidateQueries({ queryKey: unresolvedBySubjectKey(userId) });
}

export type MarkTarget = { paperId: string; questionNumber: number };

export function useSaveQuestionMemo() {
  const { userId } = useAuth();
  return useMutation({
    mutationFn: async ({ paperId, questionNumber, memo }: MarkTarget & { memo: string }) => {
      const trimmed = memo.trim().slice(0, MEMO_MAX);
      if (!trimmed) {
        const { error } = await supabase
          .from("question_memos")
          .delete()
          .eq("user_id", userId!)
          .eq("paper_id", paperId)
          .eq("question_number", questionNumber);
        if (error) throw new Error("메모 저장에 실패했어요.");
        return "";
      }
      const { error } = await supabase.from("question_memos").upsert(
        {
          user_id: userId!,
          paper_id: paperId,
          question_number: questionNumber,
          memo: trimmed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,paper_id,question_number" },
      );
      if (error) throw new Error("메모 저장에 실패했어요.");
      return trimmed;
    },
  });
}

async function upsertMark(userId: string, target: MarkTarget, patch: { pinned?: boolean; deleted?: boolean }, message: string) {
  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: userId,
      paper_id: target.paperId,
      question_number: target.questionNumber,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) throw new Error(message);
}

export function useSetQuestionPinned() {
  const { userId } = useAuth();
  return useMutation({
    mutationFn: ({ pinned, ...target }: MarkTarget & { pinned: boolean }) =>
      upsertMark(userId!, target, { pinned }, "저장에 실패했어요."),
  });
}

export function useDeleteWrongNoteQuestion() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: MarkTarget) => upsertMark(userId!, target, { deleted: true }, "삭제에 실패했어요."),
    onSuccess: () => invalidateUnresolvedCount(queryClient, userId),
  });
}

export function useRestoreWrongNoteQuestion() {
  const { userId } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: MarkTarget) => upsertMark(userId!, target, { deleted: false }, "되돌리지 못했어요."),
    onSuccess: () => invalidateUnresolvedCount(queryClient, userId),
  });
}

// ── 다시 풀기 세션 생성(EF review-create) ──────────────────────────────────────

// 웹 createReviewFromPapers / createReviewSession / createReviewFromWrong 에 대응. 멱등 키
// (§6.6 "복습 세션 생성 연타")는 같은 시도(네트워크 재시도 포함)에 같은 UUID 를 쓰고 성공하면
// 버린다 — Edge 의 30분 재사용이 없어져 연타하면 새 세션이 생기기 때문(§12-1).
export type ReviewLaunchInput =
  | { paperIds: string[] }
  | { items: ReviewItemRequestRef[] }
  | { subjectSlug: string; onlyUnresolved?: boolean; strategy?: ReviewPickStrategy };

export function useCreateReviewSession() {
  const requestId = useRef<string | null>(null);
  const lastInput = useRef<string | null>(null);
  return useMutation({
    mutationFn: async (input: ReviewLaunchInput) => {
      // 실패 뒤 **같은** 요청을 다시 누르면 같은 UUID 로 보내 세션이 둘 생기지 않게 한다.
      // 다른 시험지·문항을 고르면 다른 요청이므로 키를 새로 만든다(아니면 서버가 멱등 키로
      // 앞서 만든 세션을 그대로 돌려줘 엉뚱한 문항을 풀게 된다).
      const key = JSON.stringify(input);
      if (lastInput.current !== key) {
        lastInput.current = key;
        requestId.current = null;
      }
      requestId.current ??= Crypto.randomUUID();
      const res = await callEdge("review-create", { ...input, requestId: requestId.current });
      requestId.current = null;
      lastInput.current = null;
      return res.sessionId;
    },
  });
}
