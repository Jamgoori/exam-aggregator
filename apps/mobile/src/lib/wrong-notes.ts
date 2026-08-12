import {
  buildWrongNoteGroups,
  EMPTY_MARKS,
  wrongRatePct,
  type WrongAnswerRow,
  type WrongNoteAttemptRow,
  type WrongNoteMarks,
  type WrongNoteSubjectGroup,
} from "@gongmoa/core";
import { supabase } from "./supabase";
import { fetchWithCache } from "./offline";
import { publicUrl } from "./storage";

// 오답노트 데이터 접근. 집계 규칙(buildWrongNoteGroups)은 @gongmoa/core 로 웹과 공유해서
// 앱과 웹의 "남은 오답" 숫자가 어긋나지 않는다. 예전 lib/mypage.ts 의 근사치
// (user_question_status 만 보는 방식)를 대체한다.
//
// 여기서 쓰는 테이블은 전부 본인 행만 읽히는 RLS 가 걸려 있어(cbt_attempts,
// cbt_attempt_answers, user_question_status, wrong_note_marks) 앱에서 직접 조회한다.
// 정답(paper_answers)은 RLS 로 완전히 막혀 있어 여기서도 못 읽는다 — 화면은 문항 이미지·
// 내가 고른 답·극복 여부까지만 보여주고, 채점은 CBT/섞어풀기에서 서버가 한다.

const ATTEMPT_SELECT =
  "id, created_at, score, total_questions, exam_papers(id, title, track, level, round, choice_count, subjects(*), exam_types(*))";

// PostgREST 는 range() 없이 한 번에 1000행까지만 준다(웹 wrong-notes.ts 와 같은 이유).
const BATCH_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function fetchWrongNoteMarks(paperIds?: string[]): Promise<WrongNoteMarks> {
  const deleted = new Set<string>();
  const pinned = new Set<string>();
  if (paperIds && paperIds.length === 0) return { deleted, pinned };

  const idChunks = paperIds ? chunk(paperIds, 200) : [null];
  for (const ids of idChunks) {
    let query = supabase
      .from("wrong_note_marks")
      .select("paper_id, question_number, pinned, deleted");
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    // 마크는 부가 정보라 실패해도 화면 전체를 막지 않는다(웹과 동일하게 빈 마크로 진행).
    if (error) return EMPTY_MARKS;
    for (const r of data ?? []) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (r.deleted) deleted.add(key);
      if (r.pinned) pinned.add(key);
    }
  }
  return { deleted, pinned };
}

// "다시 볼 문제" 체크 / 오답노트에서 완전 제외. 응시 원본(cbt_attempt_answers)은 그대로
// 두고 마크만 남긴다 — 점수·전국 오답률 집계를 건드리지 않기 위해서(웹과 같은 규칙).
async function upsertMark(
  paperId: string,
  questionNumber: number,
  patch: { pinned?: boolean; deleted?: boolean },
): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("로그인 후 이용할 수 있어요.");

  const { error } = await supabase.from("wrong_note_marks").upsert(
    {
      user_id: user.id,
      paper_id: paperId,
      question_number: questionNumber,
      ...patch,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,paper_id,question_number" },
  );
  if (error) throw new Error("저장에 실패했어요.");
}

export function setQuestionPinned(paperId: string, questionNumber: number, pinned: boolean) {
  return upsertMark(paperId, questionNumber, { pinned });
}

export function setQuestionDeleted(paperId: string, questionNumber: number, deleted: boolean) {
  return upsertMark(paperId, questionNumber, { deleted });
}

async function fetchWrongAnswerRows(attemptIds: string[]): Promise<WrongAnswerRow[]> {
  const rows: WrongAnswerRow[] = [];
  for (const ids of chunk(attemptIds, 100)) {
    let from = 0;
    for (;;) {
      const { data } = await supabase
        .from("cbt_attempt_answers")
        .select("attempt_id, question_number, selected_choice")
        .in("attempt_id", ids)
        .eq("is_correct", false)
        .order("attempt_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      rows.push(...(data as WrongAnswerRow[]));
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }
  return rows;
}

// 극복 여부 override. CBT 최신 응시만 보면 섞어풀기로 극복한 문항이 반영되지 않으므로,
// CBT+섞어풀기 통합 상태인 user_question_status 를 우선한다(웹 fetchQuestionStatusMap 과
// 같은 규칙).
async function fetchQuestionStatusMap(paperIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map<string, boolean>();
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 200)) {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at")
      .in("paper_id", ids);
    const seenAt = new Map<string, string>();
    for (const r of data ?? []) {
      const key = `${r.paper_id}#${r.question_number}`;
      const at = r.last_answered_at as string;
      const prev = seenAt.get(key);
      if (!prev || at > prev) {
        seenAt.set(key, at);
        out.set(key, r.last_is_correct as boolean);
      }
    }
  }
  return out;
}

// 과목 → 문제지 → 문항으로 묶인 내 오답 전체. 웹 getWrongNoteGroups 의 앱판이다
// (웹은 중복 시험지 접기까지 하지만 앱은 아직 안 한다 — dedup 은 server-only).
export async function getWrongNoteGroups(): Promise<WrongNoteSubjectGroup[]> {
  const { data: attemptRows } = await supabase
    .from("cbt_attempts")
    .select(ATTEMPT_SELECT)
    .order("created_at", { ascending: false });

  const attempts = (attemptRows ?? []) as unknown as WrongNoteAttemptRow[];
  if (attempts.length === 0) return [];

  const paperIds = [
    ...new Set(attempts.map((a) => a.exam_papers?.id).filter((id): id is string => !!id)),
  ];
  const [wrongRows, marks, statusOverrides] = await Promise.all([
    fetchWrongAnswerRows(attempts.map((a) => a.id)),
    fetchWrongNoteMarks(paperIds),
    fetchQuestionStatusMap(paperIds),
  ]);

  return buildWrongNoteGroups(attempts, wrongRows, marks.deleted, statusOverrides);
}

// 오프라인에서도 오답노트를 열어볼 수 있게 마지막 집계 결과를 캐시한다. 문항 이미지는
// expo-image 가 자체 디스크 캐시를 갖고 있어 한 번 본 문항은 오프라인에서도 뜬다.
export async function getWrongNoteGroupsCached(): Promise<{
  groups: WrongNoteSubjectGroup[];
  fromCache: boolean;
}> {
  const { data, fromCache } = await fetchWithCache("wrong-notes", getWrongNoteGroups);
  return { groups: data, fromCache };
}

// 마이페이지 오답노트 탭의 과목 목록. 위 집계에서 그대로 뽑는다(같은 판정 = 같은 숫자).
export type WrongNoteSubjectSummary = {
  subjectId: string;
  name: string;
  slug: string;
  unresolved: number;
};

export function toSubjectSummaries(
  groups: WrongNoteSubjectGroup[],
): WrongNoteSubjectSummary[] {
  return groups
    .map((g) => ({
      subjectId: g.subject.id,
      name: g.subject.name,
      slug: g.subject.slug,
      unresolved: g.unresolvedCount,
    }))
    .sort((a, b) => b.unresolved - a.unresolved);
}

// 전국 오답률. paper_question_wrong_rates 는 security definer 라 로그인 사용자면 부를 수
// 있고, 정답이 아니라 "몇 %가 틀렸는지"만 돌려주므로 정답 유출이 아니다(웹과 같은 RPC).
// 표본이 적은 문항은 core 의 wrongRatePct 가 null 을 줘서 배지가 숨는다.
export async function fetchWrongRates(paperIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 50)) {
    const { data, error } = await supabase.rpc("paper_question_wrong_rates", {
      p_paper_ids: ids,
    });
    // 배지는 부가 정보라 실패해도 화면을 막지 않는다.
    if (error) continue;
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      attempts: number;
      wrongs: number;
    }[]) {
      const pct = wrongRatePct(Number(r.attempts), Number(r.wrongs));
      if (pct != null) out.set(`${r.paper_id}#${r.question_number}`, pct);
    }
  }
  return out;
}

// 문항 이미지(공개 읽기). `${paperId}#${questionNumber}` → 이미지 URL 목록.
export async function fetchQuestionImages(
  paperIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 10)) {
    const { data } = await supabase
      .from("questions")
      .select("paper_id, question_number, question_images(order_index, image_path)")
      .in("paper_id", ids);
    for (const row of data ?? []) {
      const images = [
        ...((row.question_images as { order_index: number; image_path: string }[] | null) ??
          []),
      ]
        .sort((a, b) => a.order_index - b.order_index)
        .map((img) => publicUrl(img.image_path));
      out.set(`${row.paper_id}#${row.question_number}`, images);
    }
  }
  return out;
}
