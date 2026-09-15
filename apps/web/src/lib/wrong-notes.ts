import "server-only";
import { cacheLife } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Subject } from "@gongmoa/core";
import {
  buildWrongNoteGroups,
  othersRoundAveragePct,
  WRONGRATE_MIN_SAMPLE,
  type WrongAnswerRow,
  type WrongNoteAttemptRow,
  type WrongNoteMarks,
  type WrongNotePaperGroup,
  type WrongNotePaperInfo,
  type WrongNoteQuestionSummary,
  type WrongNoteSubjectGroup,
} from "@gongmoa/core";
import type { QuestionExplanationContent } from "@/components/wrong-note-question-card";
import {
  fetchQuestionMedia,
  toExplanationContent,
  type ExplanationRow,
  type QuestionMediaEntry,
} from "@gongmoa/core/server";
import {
  collidingPaperIds,
  fetchPaperIdentitySignals,
  representativePaperIds,
} from "@/lib/dedup-papers";
import { applyExamTypeSubjectName, stripTrackFromTitle } from "@/lib/paper-title";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 오답노트 타입과 집계(buildWrongNoteGroups)는 @gongmoa/core 로 단일화(모바일과 공유).
// 이 파일은 조회(server-only·service_role) 담당이고, 조회 결과를 묶는 순수 계산은 core 에
// 있다. 기존 import 경로(@/lib/wrong-notes)를 그대로 쓰도록 재노출한다.
export {
  buildWrongNoteGroups,
  EMPTY_MARKS,
  WRONGRATE_MIN_SAMPLE,
  type WrongAnswerRow,
  type WrongNoteAttemptRow,
  type WrongNoteMarks,
  type WrongNotePaperGroup,
  type WrongNotePaperInfo,
  type WrongNoteQuestionSummary,
  type WrongNoteSubjectGroup,
} from "@gongmoa/core";

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// 이 파일의 조회는 대부분 "id 목록을 청크로 잘라 여러 번 왕복"하는 형태다. 예전엔 그
// 청크를 for 루프로 하나씩 기다려서, 문제지가 많은 과목(국어처럼 거의 모든 시험유형에
// 있는 과목)에서는 왕복 지연이 청크 수만큼 그대로 쌓였다. 동시에 돌리되, 한 사용자가
// 커넥션을 독점하지 않도록 동시 실행 수는 제한한다.
const QUERY_CONCURRENCY = 8;

async function inParallel<T, R>(
  items: T[],
  run: (item: T) => Promise<R>,
  limit = QUERY_CONCURRENCY,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (let i = cursor++; i < items.length; i = cursor++) {
      out[i] = await run(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}

export async function fetchWrongNoteMarks(
  supabase: Supabase,
  userId: string,
  paperIds?: string[],
): Promise<WrongNoteMarks> {
  const deleted = new Set<string>();
  const pinned = new Set<string>();
  if (paperIds && paperIds.length === 0) return { deleted, pinned };

  const idChunks: (string[] | null)[] = paperIds ? chunk(paperIds, 200) : [null];
  const failed = await inParallel(idChunks, async (ids) => {
    let query = supabase
      .from("wrong_note_marks")
      .select("paper_id, question_number, pinned, deleted")
      .eq("user_id", userId);
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    if (error) return true;
    for (const r of data ?? []) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (r.deleted) deleted.add(key);
      if (r.pinned) pinned.add(key);
    }
    return false;
  });
  // 한 청크라도 실패하면 마크를 부분 적용하지 않는다(삭제 마크가 빠지면 지운 문항이
  // 되살아나 보인다) — 예전 순차 루프의 조기 return과 같은 판단.
  if (failed.some(Boolean)) return { deleted: new Set(), pinned: new Set() };
  return { deleted, pinned };
}

// PostgREST는 range() 없이는 한 번에 최대 1000행만 돌려주므로(cbt-availability.ts와
// 같은 이유), 응시가 많은 사용자도 오답이 잘리지 않게 끝까지 이어받는다.
const BATCH_SIZE = 1000;

export async function fetchWrongAnswerRows(
  supabase: Supabase,
  attemptIds: string[],
): Promise<WrongAnswerRow[]> {
  const rows: WrongAnswerRow[] = [];
  await inParallel(chunk(attemptIds, 100), async (ids) => {
    let from = 0;
    while (true) {
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
  });
  return rows;
}

const ATTEMPT_SELECT =
  "id, created_at, score, total_questions, exam_papers(id, title, level, round, track, choice_count, subjects(*), exam_types(*))";

export async function getWrongNoteGroups(
  supabase: Supabase,
  userId: string,
): Promise<WrongNoteSubjectGroup[]> {
  const { data: attemptRows } = await supabase
    .from("cbt_attempts")
    .select(ATTEMPT_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  const attempts = (attemptRows ?? []) as unknown as WrongNoteAttemptRow[];
  if (attempts.length === 0) return [];

  const paperIds = [...new Set(attempts.map((a) => a.exam_papers?.id).filter((id): id is string => !!id))];
  const [wrongRows, marks, statusOverrides] = await Promise.all([
    fetchWrongAnswerRows(
      supabase,
      attempts.map((a) => a.id),
    ),
    fetchWrongNoteMarks(supabase, userId),
    fetchQuestionStatusMap(supabase, userId, paperIds),
  ]);
  return buildWrongNoteGroups(attempts, wrongRows, marks.deleted, statusOverrides);
}

// 화면에 그릴 수 있게 이미지/정답/해설까지 붙인 문제 상세.
export type WrongNoteQuestionDetail = WrongNoteQuestionSummary & {
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  // 해설은 등록돼 있지만 무료 회원이라 본문을 받지 않은 문항(화면은 잠금 자리를 그린다).
  // explanation === null 이면서 이 값이 false 면 "해설 자체가 없는 문항"이다.
  explanationLocked: boolean;
  // "다시 볼 문제" 체크 여부.
  pinned: boolean;
};

// 문항 이미지·선지 수 조회의 본문은 packages/core/src/data/question-media.ts 로 옮겼다
// (Edge review-*·explanations-get 도 같은 함수 — 10문제지 청크 페이지네이션). 기존
// import 경로(@/lib/wrong-notes)를 그대로 쓰도록 재노출한다.
export { fetchQuestionMedia, type QuestionMediaEntry };

// 문제지별 정답 배열. paper_answers는 정답 유출 방지를 위해 일반 select가 막혀 있어
// service role로만 읽는다 — 반드시 "본인 응시 기록이 있는 문제지"로 좁힌 뒤 호출할 것.
// (오답노트는 이미 응시를 마친 문제지만 다루고, 정답지 PDF도 공개 다운로드라
// 응시자 본인에게 문항 정답을 보여주는 건 새로운 노출이 아니다.)
export async function fetchCorrectAnswers(
  paperIds: string[],
): Promise<Map<string, number[]>> {
  const admin = createAdminClient();
  const byPaper = new Map<string, number[]>();
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, answers")
      .in("paper_id", ids);
    for (const row of data ?? []) {
      byPaper.set(row.paper_id as string, (row.answers ?? []) as number[]);
    }
  });
  return byPaper;
}

// choice_explanations 정규화(normalizeChoiceExplanations)와 행 → 화면용 해설 변환
// (toExplanationContent)은 packages/core/src/rules/explanations.ts 로 옮겼다 — Edge
// explanations-get 이 같은 함수를 쓴다(예전엔 _shared/explanations.ts 에 복사본이 있었다).
// 화면 컴포넌트가 쓰는 QuestionExplanationContent 타입과 구조가 같다.

// 문항 해설. question_explanations는 해설 제작 루틴이 관리하는 테이블로
// questions.id(question_id)를 키로 쓰므로, questions를 거쳐 (paper_id,
// question_number)로 환원한다. 해설에는 정답이 담기므로 일반 select는 막아두고
// (관리자 전용 RLS 권장) service role로만 읽는다. 해설이 없는 문항은 그냥 빠진다.
//
// 환원은 반드시 "questions 먼저 조회 → 받은 id로 해설 조회"의 두 단계로 한다.
// PostgREST의 embedded 필터(questions!inner + questions.paper_id=eq...)를 쓰면
// 생성되는 SQL의 LATERAL 안에 LIMIT이 박혀서 플래너가 조인 순서를 못 바꾸고,
// question_explanations 전체(2026-08 기준 4.7만 행)를 훑는 플랜이 나온다. 실측
// 평균 3.5초·최대 8초라 authenticator 역할의 statement_timeout(8s)에 걸려
// 20번 중 5번 실패했고, 실패는 아래 호출부에서 "해설 0건"으로 보여
// "아직 해설이 등록되지 않은 문제지예요"라는 거짓 안내가 됐다(2026-08-10 실측).
// 두 단계로 나누면 questions_paper_idx와 question_explanations_question_uidx를
// 각각 타서 10ms 안쪽이다.
const EXPLANATION_SELECT =
  "question_id, keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date";

// question_id를 IN으로 넘길 때의 한 번 분량. UUID 하나가 37자라 너무 크게 잡으면
// GET 쿼리스트링이 길어진다(fetchCorrectAnswers의 200과 같은 기준).
const QUESTION_ID_CHUNK = 200;

type QuestionKey = { paperId: string; questionNumber: number };

// 문제지들의 문항 id ↔ (문제지, 문항번호) 대응표. questions는 public read라
// service role로도 그대로 읽힌다. wanted를 주면 그 문항 번호로 좁힌다.
async function fetchQuestionKeys(
  admin: ReturnType<typeof createAdminClient>,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, QuestionKey>> {
  const byId = new Map<string, QuestionKey>();
  type Row = { id: string; paper_id: string; question_number: number };

  function consume(rows: Row[]) {
    for (const row of rows) {
      byId.set(row.id, {
        paperId: row.paper_id,
        questionNumber: row.question_number,
      });
    }
  }

  if (wanted) {
    await inParallel(paperIds, async (paperId) => {
      const numbers = [...(wanted.get(paperId) ?? [])];
      if (numbers.length === 0) return;
      // 문항 번호로 좁히면 문제지 하나가 BATCH_SIZE를 넘길 일이 없다.
      const { data, error } = await admin
        .from("questions")
        .select("id, paper_id, question_number")
        .eq("paper_id", paperId)
        .in("question_number", numbers);
      if (error) throw error;
      consume((data ?? []) as Row[]);
    });
    return byId;
  }

  await inParallel(chunk(paperIds, 10), async (ids) => {
    let from = 0;
    while (true) {
      const { data, error } = await admin
        .from("questions")
        .select("id, paper_id, question_number")
        .in("paper_id", ids)
        .order("paper_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      consume(data as Row[]);
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  });
  return byId;
}

// wanted(문제지별 필요한 문항 번호)를 주면 그 문항의 해설만 받아온다. 해설 한 건은
// 선지별 텍스트가 담긴 jsonb라 행 하나가 무거워서, 문제지 전체를 받던 예전 방식은
// 문제지 수에 비례해 그대로 지연이 됐다(화면에는 틀린 문항 해설만 쓴다).
//
// required=true면 조회 실패를 그대로 던진다. 해설 자체가 본문인 화면
// (/papers/[id]/explanations)은 실패를 빈 결과로 뭉개면 "해설이 없다"고 단언해
// 버리기 때문이다. 오답노트처럼 해설이 곁다리인 화면은 기본값(false)으로 두어,
// 해설 조회가 실패해도 본문인 "내가 틀린 문항"은 살려서 보여준다.
export async function fetchExplanations(
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
  required = false,
): Promise<Map<string, Map<number, QuestionExplanationContent>>> {
  const admin = createAdminClient();
  const byPaper = new Map<string, Map<number, QuestionExplanationContent>>();

  try {
    const keys = await fetchQuestionKeys(admin, paperIds, wanted);
    const questionIds = [...keys.keys()];
    if (questionIds.length === 0) return byPaper;

    await inParallel(chunk(questionIds, QUESTION_ID_CHUNK), async (ids) => {
      // question_id에 unique 인덱스가 걸려 있어 문항당 해설은 최대 1건이다
      // (upsert 전제 — question_explanations_question_uidx). 그래서 청크 하나가
      // 돌려주는 행 수는 ids 길이를 넘지 않고, 페이지네이션도 필요 없다.
      const { data, error } = await admin
        .from("question_explanations")
        .select(EXPLANATION_SELECT)
        .in("question_id", ids);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = keys.get((row as { question_id: string }).question_id);
        if (!key) continue;
        const content = toExplanationContent(row as unknown as ExplanationRow);
        if (!content) continue;
        const paperMap =
          byPaper.get(key.paperId) ?? new Map<number, QuestionExplanationContent>();
        paperMap.set(key.questionNumber, content);
        byPaper.set(key.paperId, paperMap);
      }
    });
  } catch (e) {
    // 조용히 삼키면 화면이 "해설 없음"으로 보인다 — 로그는 언제나 남긴다.
    console.error("fetchExplanations 실패", { paperIds, error: e });
    if (required) throw e;
    return new Map();
  }

  return byPaper;
}

// 해설 "있음/없음"만 확인한다(본문은 받지 않는다).
//
// 무료 회원의 오답노트는 해설을 잠금 자리로 덮는데, 그 자리를 그리려면 그 문항에
// 실제로 해설이 있는지 알아야 한다 — 해설이 없는 문항까지 "멤버십에서 볼 수 있어요"로
// 덮으면 결제한 뒤에 빈 자리만 남아 거짓 안내가 된다.
//
// 잠금은 CSS 블러가 아니라 이 경로로 만든다. 본문을 내려보내고 화면에서 흐리게만
// 하면 개발자도구로 그대로 읽힌다 — 무료 회원에게는 해설 본문이 아예 서버를 떠나지
// 않아야 한다. 이 조회는 본문(jsonb)을 빼고 question_id만 받으므로
// fetchExplanations 보다 훨씬 가볍다.
export async function fetchExplainedNumbers(
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, Set<number>>> {
  const admin = createAdminClient();
  const byPaper = new Map<string, Set<number>>();

  try {
    const keys = await fetchQuestionKeys(admin, paperIds, wanted);
    const questionIds = [...keys.keys()];
    if (questionIds.length === 0) return byPaper;

    await inParallel(chunk(questionIds, QUESTION_ID_CHUNK), async (ids) => {
      const { data, error } = await admin
        .from("question_explanations")
        .select("question_id")
        .in("question_id", ids);
      if (error) throw error;
      for (const row of data ?? []) {
        const key = keys.get((row as { question_id: string }).question_id);
        if (!key) continue;
        const set = byPaper.get(key.paperId) ?? new Set<number>();
        set.add(key.questionNumber);
        byPaper.set(key.paperId, set);
      }
    });
  } catch (e) {
    // 실패하면 잠금 자리 없이 그린다(해설이 없는 문항과 같은 모양). 본문인 "내가 틀린
    // 문항"은 살려서 보여주는 fetchExplanations 의 판단과 같다.
    console.error("fetchExplainedNumbers 실패", { paperIds, error: e });
    return new Map();
  }

  return byPaper;
}

function toQuestionDetail(
  q: WrongNoteQuestionSummary,
  paper: WrongNotePaperInfo,
  media: Map<number, QuestionMediaEntry> | undefined,
  answers: number[] | undefined,
  explanations: Map<number, QuestionExplanationContent> | undefined,
  pinnedKeys?: Set<string>,
  // 해설은 있지만 멤버십이 아니라 본문을 안 받은 문항 번호들.
  lockedNumbers?: Set<number>,
): WrongNoteQuestionDetail {
  const entry = media?.get(q.questionNumber);
  return {
    ...q,
    correctChoice: answers?.[q.questionNumber - 1] ?? null,
    choiceCount: entry?.choiceCount ?? paper.choice_count,
    images: entry?.images ?? [],
    explanation: explanations?.get(q.questionNumber) ?? null,
    explanationLocked: lockedNumbers?.has(q.questionNumber) ?? false,
    pinned: pinnedKeys?.has(`${paper.id}#${q.questionNumber}`) ?? false,
  };
}

// 과목 오답노트 페이지용: 오답이 있는 문제지 목록을 요약(회독 수·최근 점수·오답/극복
// 수)만으로 돌려준다. 문항 이미지·해설은 문제지 오답노트 페이지에서 그 문제지 것만
// 받는다 — 회독이 쌓여도 과목 페이지가 무거워지지 않게 하려는 분리다.
// 과목 slug가 존재하지 않으면 null.
// 과목 slug → 과목. 오답 집계와 무관하게 가벼워서, 무거운 목록을 기다리는 동안
// 화면 뼈대(과목명·탭)를 먼저 그리는 데 쓴다. 없는 slug면 null(404 처리용).
export async function getSubjectBySlug(
  supabase: Supabase,
  slug: string,
): Promise<Subject | null> {
  const { data } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Subject) ?? null;
}

export async function getSubjectWrongNoteOverview(
  supabase: Supabase,
  userId: string,
  slug: string,
): Promise<{ subject: Subject; papers: WrongNotePaperGroup[] } | null> {
  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow as Subject;

  const groups = await getWrongNoteGroups(supabase, userId);
  const group = groups.find((g) => g.subject.id === subject.id);
  return { subject, papers: group?.papers ?? [] };
}

// ── 과목 문항 모아보기 (과목 오답을 문제지 경계 없이 문항 단위로 펼침) ──────────
//
// 과목 오답노트의 "문항 모아보기" 탭용. 문제지별 요약과 달리, 그 과목에서 틀린
// 문항 전체를 이미지·정답·해설까지 붙여 한 목록으로 돌려준다. 필터·정렬은 화면
// (클라이언트)에서 하고 여기서는 정렬 안정성을 위해 (문제지 제목, 문항 번호)
// 순으로만 정돈해 둔다 — 세트문제(공통지문) 병합이 같은 문제지 내 연속 문항에서
// 성립하도록.
//
// 중복 시험지(직류만 다른 같은 시험지) 처리: 같은 과목 안에서 track만 다른 문제지
// 두 행에 각각 응시 기록이 있으면 같은 문항이 두 번 잡힌다. dedup-papers의 대표
// 선정 규칙을 그대로 써서 응시를 대표 문제지 id로 접은 뒤 문항을 합친다(표시 통합과
// 동일 기준).

export type SubjectWrongNoteQuestion = {
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  questionNumber: number;
  wrongCount: number;
  resolved: boolean;
  // 가장 최근에 틀렸을 때 고른 답 (null이면 풀지 않고 넘어감).
  selectedChoice: number | null;
  // 가장 최근에 이 문항을 틀린 응시 시각 ("최근 틀린 순" 정렬용).
  lastWrongAt: string;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  // 해설은 있지만 무료 회원이라 본문을 받지 않은 문항(화면은 잠금 자리를 그린다).
  explanationLocked: boolean;
  // 사용자가 이 문항에 남긴 개인 메모(없으면 null).
  memo: string | null;
  // 전국 오답률(%). 표본이 충분한 문항만 채워지고, 적으면 null(배지 숨김).
  wrongRatePct: number | null;
  // "다시 볼 문제" 체크 여부.
  pinned: boolean;
};

// 전국 오답률 배지를 띄우기 위한 최소 표본(이보다 적으면 오해를 주므로 숨긴다).


export type SubjectWrongNoteQuestions = {
  subject: Subject;
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
  resolvedCount: number;
};

// dedup 대표 선정에 필요한 필드까지 포함해 응시를 받는다. subjects/exam_types는
// 표시용.
type SubjectAttemptPaper = {
  id: string;
  title: string;
  level: string | null;
  choice_count: number;
  subject_id: string;
  exam_type_id: string;
  year: number;
  round: number;
  track: string | null;
  created_at: string;
};

type SubjectAttemptRow = {
  id: string;
  created_at: string;
  exam_papers: SubjectAttemptPaper | null;
};

const SUBJECT_ATTEMPT_SELECT =
  "id, created_at, exam_papers!inner(id, title, level, choice_count, subject_id, exam_type_id, year, round, track, created_at)";

// 문항별 통합 상태(user_question_status)를 대표 문제지+문항 키로 접어 받아온다.
// 중복 시험지는 실제 paper_id별로 상태가 흩어질 수 있어, 같은 대표+문항 중 가장
// 최근(last_answered_at) 것을 쓴다. RLS로 본인 행만 조회된다.
async function fetchQuestionStatusByRep(
  supabase: Supabase,
  userId: string,
  realPaperIds: string[],
  repId: (paperId: string) => string,
): Promise<Map<string, { correct: boolean; at: string }>> {
  const out = new Map<string, { correct: boolean; at: string }>();
  if (realPaperIds.length === 0) return out;
  await inParallel(chunk(realPaperIds, 200), async (ids) => {
    const { data } = await supabase
      .from("user_question_status")
      .select("paper_id, question_number, last_is_correct, last_answered_at")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const row of data ?? []) {
      const key = `${repId(row.paper_id as string)}#${row.question_number as number}`;
      const at = row.last_answered_at as string;
      const ex = out.get(key);
      if (!ex || at > ex.at) {
        out.set(key, { correct: row.last_is_correct as boolean, at });
      }
    }
  });
  return out;
}

// buildWrongNoteGroups용 statusOverrides. fetchQuestionStatusByRep을 항등 매핑(중복
// 시험지 접기 없이 실제 paper_id 그대로)으로 불러 극복 여부만 남긴다.
export async function fetchQuestionStatusMap(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<Map<string, boolean>> {
  const raw = await fetchQuestionStatusByRep(supabase, userId, paperIds, (id) => id);
  const out = new Map<string, boolean>();
  for (const [key, v] of raw) out.set(key, v.correct);
  return out;
}

// 문항 메모(본인 것만, RLS). `${paperId}#${qnum}` → 메모.
export async function fetchMemos(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paperIds.length === 0) return out;
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await supabase
      .from("question_memos")
      .select("paper_id, question_number, memo")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of data ?? []) {
      const memo = (r.memo as string | null)?.trim();
      if (memo) out.set(`${r.paper_id}#${r.question_number}`, memo);
    }
  });
  return out;
}

// 전국 오답률(%). paper_question_wrong_rates(security definer)로 전체 응시를 집계.
// 표본이 WRONGRATE_MIN_SAMPLE 미만이면 넣지 않는다(작은 표본은 오해를 준다).
//
// 이 집계는 문제지 하나의 cbt_attempt_answers 전체를 훑는다 — 응시가 많이 쌓인 인기
// 문제지(국어처럼 모든 시험유형에 있는 과목)에서는 페이지를 열 때마다 수십만~수백만
// 행을 다시 세는 셈이라, 과목 문항 모아보기 지연의 가장 큰 몫이었다. 결과는 로그인
// 사용자와 무관한 전체 통계라 문제지 단위로 캐싱하면 같은 문제지를 보는 모든 사용자가
// 재사용한다(문제지 단위 키라 사용자마다 문제지 조합이 달라도 캐시가 맞는다).
// 응시가 계속 쌓여도 오답률 %는 천천히 움직여 10분 지연은 표시에 영향이 없다.
//
// cookies()를 건드리지 않는 클라이언트를 써야 'use cache' 안에서 안전해서, 사용자
// 세션 클라이언트 대신 admin 클라이언트로 부른다(반환값은 정답이 아닌 집계 수치뿐).
async function fetchPaperWrongRates(
  paperId: string,
): Promise<{ questionNumber: number; pct: number }[]> {
  "use cache";
  cacheLife({ revalidate: 600 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("paper_question_wrong_rates", {
    p_paper_ids: [paperId],
  });
  if (error) return []; // 함수 미적용 환경: 배지 없이 넘어간다.
  const out: { questionNumber: number; pct: number }[] = [];
  for (const r of (data ?? []) as {
    paper_id: string;
    question_number: number;
    attempts: number;
    wrongs: number;
  }[]) {
    if (r.attempts < WRONGRATE_MIN_SAMPLE) continue;
    out.push({
      questionNumber: r.question_number,
      pct: Math.round((r.wrongs / r.attempts) * 100),
    });
  }
  return out;
}

async function fetchWrongRates(paperIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (paperIds.length === 0) return out;
  const perPaper = await inParallel(paperIds, (id) => fetchPaperWrongRates(id));
  paperIds.forEach((paperId, i) => {
    for (const r of perPaper[i] ?? []) {
      out.set(`${paperId}#${r.questionNumber}`, r.pct);
    }
  });
  return out;
}

// 이 과목 문제지에 붙은, 한 번이라도 틀린 문항 상태 행(user_question_status)을 문제지
// 정보와 함께 받는다. 과목 제한은 exam_papers 임베드 FK 로 건다(RLS: 본인 행만).
type SubjectStatusWrong = {
  paper: SubjectAttemptPaper;
  questionNumber: number;
  wrongCount: number;
  lastAnsweredAt: string;
};

async function fetchSubjectStatusWrongs(
  supabase: Supabase,
  userId: string,
  subjectId: string,
): Promise<SubjectStatusWrong[]> {
  type Row = {
    paper_id: string;
    question_number: number;
    wrong_count: number | null;
    last_answered_at: string;
    exam_papers: SubjectAttemptPaper | null;
  };
  const out: SubjectStatusWrong[] = [];
  let from = 0;
  while (true) {
    const { data } = await supabase
      .from("user_question_status")
      .select(
        "paper_id, question_number, wrong_count, last_answered_at, exam_papers!inner(id, title, level, choice_count, subject_id, exam_type_id, year, round, track, created_at)",
      )
      .eq("user_id", userId)
      .gt("wrong_count", 0)
      .eq("exam_papers.subject_id", subjectId)
      // range 로 이어받을 때 페이지 경계가 흔들리지 않게 키 순으로 고정한다.
      .order("paper_id", { ascending: true })
      .order("question_number", { ascending: true })
      .range(from, from + BATCH_SIZE - 1);
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      if (!r.exam_papers) continue;
      out.push({
        paper: r.exam_papers,
        questionNumber: r.question_number,
        wrongCount: r.wrong_count ?? 1,
        lastAnsweredAt: r.last_answered_at,
      });
    }
    if (rows.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return out;
}

// 섞어풀기·복습 세션에서 마지막으로 틀렸을 때 고른 답. review_session_items 는 RLS
// 정책이 없어 service_role 로 읽고, 세션의 user_id 로 본인 것만 좁힌다.
async function fetchLastReviewChoices(
  userId: string,
  keys: { repId: string; questionNumber: number }[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (keys.length === 0) return out;
  const admin = createAdminClient();
  const wanted = new Set(keys.map((k) => `${k.repId}#${k.questionNumber}`));
  const paperIds = [...new Set(keys.map((k) => k.repId))];
  type Row = {
    paper_id: string;
    question_number: number;
    selected_choice: number | null;
    review_sessions: { user_id: string; submitted_at: string | null } | null;
  };
  const latest = new Map<string, string>();
  await inParallel(chunk(paperIds, 100), async (ids) => {
    const { data } = await admin
      .from("review_session_items")
      .select(
        "paper_id, question_number, selected_choice, review_sessions!inner(user_id, submitted_at)",
      )
      .eq("review_sessions.user_id", userId)
      .eq("is_correct", false)
      .in("paper_id", ids);
    for (const r of (data ?? []) as unknown as Row[]) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (!wanted.has(key)) continue;
      const at = r.review_sessions?.submitted_at ?? "";
      const prev = latest.get(key);
      if (prev === undefined || at > prev) {
        latest.set(key, at);
        out.set(key, r.selected_choice);
      }
    }
  });
  return out;
}

// includeExplanations=false 면 해설 본문을 조회하지 않고 "해설이 있는 문항"만 표시해
// 준다(무료 회원). 오답노트 열람 자체는 무료라 목록·이미지·정답은 그대로 내려가고,
// 해설만 잠금 자리로 바뀐다 — 무료 해설 한도(FREE_EXPLANATION_DAILY_PAPERS)가 이
// 경로로 새지 않게 하려는 것.
export async function getSubjectWrongNoteQuestions(
  supabase: Supabase,
  userId: string,
  slug: string,
  includeExplanations = true,
): Promise<SubjectWrongNoteQuestions | null> {
  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow as Subject;

  const { data: attemptRows } = await supabase
    .from("cbt_attempts")
    .select(SUBJECT_ATTEMPT_SELECT)
    .eq("user_id", userId)
    .eq("exam_papers.subject_id", subject.id)
    .order("created_at", { ascending: false });

  const attempts = ((attemptRows ?? []) as unknown as SubjectAttemptRow[]).filter(
    (a) => a.exam_papers,
  );

  // CBT 응시 없이 채점된 오답 — 기출 섞어풀기(과목 기출 전체에서 뽑아 푼다)와 진단의
  // "같은개념 기출"이 여기 해당한다. 응시(cbt_attempts)에는 없고 통합 상태
  // (user_question_status)에만 있어, 응시만 훑으면 그 오답이 이 목록에서 통째로 빠진다.
  // 문제지의 과목으로 좁혀 이 과목 것만 받는다.
  const extraStatus = await fetchSubjectStatusWrongs(supabase, userId, subject.id);

  if (attempts.length === 0 && extraStatus.length === 0) {
    return { subject, questions: [], unresolvedCount: 0, resolvedCount: 0 };
  }

  // 응시에 등장한 문제지들(중복 제거) — dedup 대표 계산 입력. 상태에만 있는 오답의
  // 문제지도 함께 넣어야 대표·제목·마크 정규화가 같은 기준으로 돈다.
  const distinctPapers = new Map<string, SubjectAttemptPaper>();
  for (const a of attempts) {
    const p = a.exam_papers!;
    if (!distinctPapers.has(p.id)) distinctPapers.set(p.id, p);
  }
  for (const r of extraStatus) {
    if (!distinctPapers.has(r.paper.id)) distinctPapers.set(r.paper.id, r.paper);
  }
  const paperList = [...distinctPapers.values()];

  // 겹칠 수 있는 문제지에 대해서만 정답 지문을 조회해 대표를 정한다.
  const collidingIds = collidingPaperIds(paperList);
  const signals =
    collidingIds.length > 0
      ? await fetchPaperIdentitySignals(supabase, collidingIds)
      : undefined;
  const { repByPaperId, finalGroupSizeByRepId } = representativePaperIds(
    paperList,
    signals,
  );
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;

  // 대표 문제지 표시 정보. 실제로 합쳐진(2건 이상) 대표는 title에서 track 접미사를 뗀다.
  const repInfo = new Map<string, { title: string; level: string | null; choiceCount: number }>();
  for (const p of paperList) {
    if (repId(p.id) !== p.id) continue;
    const collapsed = (finalGroupSizeByRepId.get(p.id) ?? 1) > 1;
    repInfo.set(p.id, {
      // 시행처 표기(군무원 행정법총론 → 행정법)는 제목이 어디에 실리든 같아야 해서
      // 여기서도 건다 — 카드는 행정법인데 오답노트만 행정법총론이면 같은 문제지가
      // 화면마다 다른 과목이 된다.
      title: applyExamTypeSubjectName(
        collapsed && p.track ? stripTrackFromTitle(p.title, p.track) : p.title,
      ),
      level: p.level,
      choiceCount: p.choice_count,
    });
  }

  const wrongRows = await fetchWrongAnswerRows(
    supabase,
    attempts.map((a) => a.id),
  );
  const wrongByAttempt = new Map<string, WrongAnswerRow[]>();
  for (const row of wrongRows) {
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    wrongByAttempt.set(row.attempt_id, list);
  }

  // 대표별 "가장 최근 응시" = 최신순 attempts에서 처음 만나는 것. 그 응시에서
  // 틀리지 않은 문항은 극복으로 본다.
  const latestAttemptIdByRep = new Map<string, string>();
  for (const a of attempts) {
    const r = repId(a.exam_papers!.id);
    if (!latestAttemptIdByRep.has(r)) latestAttemptIdByRep.set(r, a.id);
  }
  const wrongInLatestByRep = new Map<string, Set<number>>();
  for (const [r, attemptId] of latestAttemptIdByRep) {
    wrongInLatestByRep.set(
      r,
      new Set((wrongByAttempt.get(attemptId) ?? []).map((w) => w.question_number)),
    );
  }

  // (대표 문제지, 문항 번호)로 오답을 합친다. 최신순으로 훑으므로 처음 만든 값이
  // "가장 최근에 고른 답 / 가장 최근에 틀린 시각"이 된다.
  type Agg = {
    repId: string;
    questionNumber: number;
    wrongCount: number;
    selectedChoice: number | null;
    lastWrongAt: string;
  };
  const byRepQ = new Map<string, Agg>();
  for (const a of attempts) {
    const r = repId(a.exam_papers!.id);
    for (const row of wrongByAttempt.get(a.id) ?? []) {
      const key = `${r}#${row.question_number}`;
      const existing = byRepQ.get(key);
      if (existing) {
        existing.wrongCount++;
      } else {
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

  // 상태에만 있는 오답을 보탠다. 응시로 이미 잡힌 문항은 응시 쪽 값(그때 고른 답)을
  // 그대로 두고, 없는 문항만 추가한다. 고른 답은 섞어풀기 세션 기록에서 되짚는다.
  const extraKeys: { repId: string; questionNumber: number }[] = [];
  for (const r of extraStatus) {
    const rep = repId(r.paper.id);
    const key = `${rep}#${r.questionNumber}`;
    if (byRepQ.has(key)) continue;
    byRepQ.set(key, {
      repId: rep,
      questionNumber: r.questionNumber,
      wrongCount: r.wrongCount,
      selectedChoice: null,
      lastWrongAt: r.lastAnsweredAt,
    });
    extraKeys.push({ repId: rep, questionNumber: r.questionNumber });
  }
  if (extraKeys.length > 0) {
    const chosen = await fetchLastReviewChoices(userId, extraKeys);
    for (const k of extraKeys) {
      const agg = byRepQ.get(`${k.repId}#${k.questionNumber}`);
      const choice = chosen.get(`${k.repId}#${k.questionNumber}`);
      if (agg && choice !== undefined) agg.selectedChoice = choice;
    }
  }

  const repIds = [...repInfo.keys()];
  // 화면에 실제로 그릴 (대표 문제지, 문항 번호)만 이미지·해설 조회 대상으로 넘긴다 —
  // 문제지 전체를 받던 예전 방식은 문제지가 쌓일수록 안 쓰는 데이터가 대부분이었다.
  const wantedNumbers = new Map<string, Set<number>>();
  for (const agg of byRepQ.values()) {
    const set = wantedNumbers.get(agg.repId) ?? new Set<number>();
    set.add(agg.questionNumber);
    wantedNumbers.set(agg.repId, set);
  }

  const [
    mediaByPaper,
    answersByPaper,
    explanationsByPaper,
    explainedByPaper,
    statusByRepQ,
    memoByRepQ,
    rateByRepQ,
    rawMarks,
  ] =
    await Promise.all([
      fetchQuestionMedia(supabase, repIds, wantedNumbers),
      fetchCorrectAnswers(repIds),
      includeExplanations
        ? fetchExplanations(repIds, wantedNumbers)
        : new Map<string, Map<number, QuestionExplanationContent>>(),
      includeExplanations
        ? new Map<string, Set<number>>()
        : fetchExplainedNumbers(repIds, wantedNumbers),
      fetchQuestionStatusByRep(supabase, userId, paperList.map((p) => p.id), repId),
      fetchMemos(supabase, userId, repIds),
      fetchWrongRates(repIds),
      fetchWrongNoteMarks(supabase, userId, paperList.map((p) => p.id)),
    ]);

  // 마크는 실제 paper_id로 저장돼 있을 수 있어(문제지 드릴다운에서 찍은 것) 대표
  // 키로 정규화해 비교한다.
  const normalizeMarkKeys = (keys: Set<string>) => {
    const out = new Set<string>();
    for (const k of keys) {
      const idx = k.lastIndexOf("#");
      out.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
    }
    return out;
  };
  const deletedRepKeys = normalizeMarkKeys(rawMarks.deleted);
  const pinnedRepKeys = normalizeMarkKeys(rawMarks.pinned);

  const questions: SubjectWrongNoteQuestion[] = [];
  for (const agg of byRepQ.values()) {
    if (deletedRepKeys.has(`${agg.repId}#${agg.questionNumber}`)) continue;
    const info = repInfo.get(agg.repId);
    if (!info) continue;
    const media = mediaByPaper.get(agg.repId)?.get(agg.questionNumber);
    const answers = answersByPaper.get(agg.repId);
    // 극복 판정: user_question_status(CBT+섞어풀기 통합 최신 결과)를 우선 사용하고,
    // 없으면(테이블 미적용/기록 없음) CBT 최신 응시 기준으로 폴백한다. 이렇게 하면
    // 섞어풀기에서 맞힌 문항이 여기 목록·섞어풀기 후보에서 극복으로 반영된다.
    const status = statusByRepQ.get(`${agg.repId}#${agg.questionNumber}`);
    const resolved = status
      ? status.correct
      : !wrongInLatestByRep.get(agg.repId)?.has(agg.questionNumber);
    questions.push({
      paperId: agg.repId,
      paperTitle: info.title,
      paperLevel: info.level,
      questionNumber: agg.questionNumber,
      wrongCount: agg.wrongCount,
      resolved,
      selectedChoice: agg.selectedChoice,
      lastWrongAt: agg.lastWrongAt,
      correctChoice: answers?.[agg.questionNumber - 1] ?? null,
      choiceCount: media?.choiceCount ?? info.choiceCount,
      images: media?.images ?? [],
      explanation: explanationsByPaper.get(agg.repId)?.get(agg.questionNumber) ?? null,
      explanationLocked:
        explainedByPaper.get(agg.repId)?.has(agg.questionNumber) ?? false,
      memo: memoByRepQ.get(`${agg.repId}#${agg.questionNumber}`) ?? null,
      wrongRatePct: rateByRepQ.get(`${agg.repId}#${agg.questionNumber}`) ?? null,
      pinned: pinnedRepKeys.has(`${agg.repId}#${agg.questionNumber}`),
    });
  }

  // 세트문제 병합이 성립하도록 (제목, 번호) 순 안정 정렬. 화면이 다시 정렬한다.
  questions.sort(
    (a, b) =>
      a.paperTitle.localeCompare(b.paperTitle, "ko") ||
      a.questionNumber - b.questionNumber,
  );
  const unresolvedCount = questions.filter((q) => !q.resolved).length;

  return {
    subject,
    questions,
    unresolvedCount,
    resolvedCount: questions.length - unresolvedCount,
  };
}

// 과목별 "미극복 오답 수"를 user_question_status(CBT+섞어풀기 통합) 기준으로 센다.
// 허브(마이페이지 오답노트 탭)의 총계·과목 배지·오늘 카드가 이 값을 쓰면, 섞어풀기로
// 극복한 문항이 즉시 반영되고(헤드라인 숫자가 줄고), "미극복 N" 오늘 카드 수치가
// 실제 섞어풀기 후보와 일치해 "N개라며 눌렀더니 0개" dead-end가 사라진다.
// buildWrongNoteGroups(응시 최신 기준)과 달리 섞어풀기 결과까지 본다.
// 복습 대상(간격 반복 lite): 미극복 오답 중 마지막으로 푼 지 이만큼 지난 문항을
// "오늘 복습할 것"으로 본다. 별도 컬럼 없이 last_answered_at로 파생한다.
export const REVIEW_COOLDOWN_HOURS = 24;

export async function getUnresolvedCountBySubject(
  supabase: Supabase,
  userId: string,
): Promise<Map<string, { name: string; slug: string; unresolved: number; due: number }>> {
  const out = new Map<string, { name: string; slug: string; unresolved: number; due: number }>();
  const dueCutoff = new Date(Date.now() - REVIEW_COOLDOWN_HOURS * 3600 * 1000).toISOString();

  const statusRows: {
    paper_id: string;
    question_number: number;
    last_is_correct: boolean;
    last_answered_at: string;
  }[] = [];
  {
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("user_question_status")
        .select("paper_id, question_number, last_is_correct, last_answered_at")
        .eq("user_id", userId)
        .gt("wrong_count", 0)
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      statusRows.push(...(data as typeof statusRows));
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }
  if (statusRows.length === 0) return out;

  const marks = await fetchWrongNoteMarks(supabase, userId);

  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];

  // dedup 대표 계산 + 대표 문제지의 과목. 중복 시험지가 각각 응시됐어도 한 번만 센다.
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
    const { data } = await supabase
      .from("exam_papers")
      .select("id, subject_id, exam_type_id, year, round, level, title, subjects(id, name, slug)")
      .in("id", ids);
    for (const p of (data ?? []) as unknown as PaperMeta[]) papers.push(p);
  });
  const { repByPaperId } = representativePaperIds(papers);
  const repId = (paperId: string) => repByPaperId.get(paperId) ?? paperId;
  const subjectOfPaper = new Map<string, { id: string; name: string; slug: string }>();
  for (const p of papers) if (p.subjects) subjectOfPaper.set(p.id, p.subjects);

  // 완전 삭제 마크를 대표 키로 정규화(드릴다운에서 실제 paper_id로 찍혔을 수 있다).
  const deletedRepKeys = new Set<string>();
  for (const k of marks.deleted) {
    const idx = k.lastIndexOf("#");
    deletedRepKeys.add(`${repId(k.slice(0, idx))}#${k.slice(idx + 1)}`);
  }

  // (대표, 문항)별로 가장 최근 상태만 남긴다(중복 시험지의 status가 흩어져도 통합).
  const byRepQ = new Map<string, { resolved: boolean; at: string; subjectId: string | null }>();
  for (const r of statusRows) {
    const rep = repId(r.paper_id);
    if (deletedRepKeys.has(`${rep}#${r.question_number}`)) continue;
    const subj = subjectOfPaper.get(rep) ?? subjectOfPaper.get(r.paper_id) ?? null;
    const key = `${rep}#${r.question_number}`;
    const ex = byRepQ.get(key);
    if (!ex || r.last_answered_at > ex.at) {
      byRepQ.set(key, {
        resolved: r.last_is_correct,
        at: r.last_answered_at,
        subjectId: subj?.id ?? null,
      });
    }
  }

  const nameSlug = new Map<string, { name: string; slug: string }>();
  for (const s of subjectOfPaper.values()) nameSlug.set(s.id, { name: s.name, slug: s.slug });

  for (const v of byRepQ.values()) {
    if (v.resolved || !v.subjectId) continue;
    const meta = nameSlug.get(v.subjectId);
    if (!meta) continue;
    const e = out.get(v.subjectId) ?? { name: meta.name, slug: meta.slug, unresolved: 0, due: 0 };
    e.unresolved++;
    if (v.at <= dueCutoff) e.due++;
    out.set(v.subjectId, e);
  }
  return out;
}

// 홈 화면 오답노트 바로가기 배너용: 마이페이지 "남은 오답"과 같은 값을 하나의
// 숫자로 돌려준다. 과목별 집계(getUnresolvedCountBySubject)를 그대로 재사용해
// 마이페이지 헤드라인과 숫자가 어긋나지 않도록 한다.
export async function getMyUnresolvedTotal(
  supabase: Supabase,
  userId: string,
): Promise<number> {
  const bySubject = await getUnresolvedCountBySubject(supabase, userId);
  let total = 0;
  for (const v of bySubject.values()) total += v.unresolved;
  return total;
}

// ── 회독별 "다른 회원 평균 점수" (멤버십 전용 표시) ─────────────────────────
//
// 문제지 오답노트의 회독 스트립 옆에 "내 3회독 82점 · 다른 회원 평균 71점"을 붙이는
// 데 쓴다. 내 점수만 보면 그게 잘한 건지 알 수 없다 — 같은 문제지를 같은 회독만큼
// 푼 사람들과 견줘야 의미가 생긴다.

export type PaperRoundComparison = {
  round: number;
  myPct: number;
  // 나를 뺀 다른 회원 평균(%). 표본이 모자란 회독은 null(화면에서 비교를 숨긴다).
  othersAvgPct: number | null;
  // 평균을 낸 사람 수(나 제외). 표본이 몇인지 안 보여주면 숫자를 믿을 근거가 없다.
  othersCount: number;
};

// 문제지의 회독별 (응시 수, 점수 백분율 합). 로그인 사용자와 무관한 전체 통계라
// 문제지 단위로 캐싱하면 같은 문제지를 보는 모든 사용자가 재사용한다
// (fetchPaperWrongRates 와 같은 판단 — 응시가 쌓여도 평균은 천천히 움직인다).
// 조회에 실패하면(함수 미적용 등) 빈 배열이 아니라 null을 돌려준다. 빈 배열로
// 뭉개면 화면이 "아직 응시가 적어 평균을 낼 수 없어요"라고 단언해 버리는데, 실제
// 원인은 표본이 아니라 함수가 없는 것이라 거짓 안내가 된다(해설 조회 실패를
// "해설 없음"으로 뭉개 사고가 났던 것과 같은 함정). null이면 화면은 비교 영역을
// 통째로 그리지 않는다.
async function fetchPaperRoundScoreStats(
  paperId: string,
): Promise<{ roundNumber: number; attempts: number; pctSum: number }[] | null> {
  "use cache";
  cacheLife({ revalidate: 600 });

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("paper_round_score_stats", {
    p_paper_id: paperId,
  });
  if (error) {
    console.error("paper_round_score_stats 실패", { paperId, error });
    return null;
  }
  return ((data ?? []) as { round_number: number; attempts: number; pct_sum: number }[]).map(
    (r) => ({
      roundNumber: Number(r.round_number),
      // PostgREST 는 bigint/numeric 을 문자열로 줄 수 있어 항상 숫자로 세운다.
      attempts: Number(r.attempts),
      pctSum: Number(r.pct_sum),
    }),
  );
}

// 내 회독 기록에 "그 회독을 푼 다른 회원들의 평균"을 붙여 돌려준다. 멤버십 전용
// 표시라 호출부(문제지 오답노트 페이지)가 프리미엄일 때만 부른다.
export async function getPaperRoundComparisons(
  paperId: string,
  rounds: { round: number; score: number; totalQuestions: number }[],
): Promise<PaperRoundComparison[]> {
  if (rounds.length === 0) return [];
  const stats = await fetchPaperRoundScoreStats(paperId);
  if (!stats) return [];
  const byRound = new Map(stats.map((s) => [s.roundNumber, s]));

  return rounds
    .filter((r) => r.totalQuestions > 0)
    .map((r) => {
      const myPct = (r.score * 100) / r.totalQuestions;
      const stat = byRound.get(r.round);
      // 집계에 내 응시가 없으면(캐시가 내 응시 전에 만들어졌다) 뺄 것도 없다.
      const includesMe = (stat?.attempts ?? 0) > 0;
      return {
        round: r.round,
        myPct: Math.round(myPct),
        othersAvgPct: stat
          ? othersRoundAveragePct(stat.attempts, stat.pctSum, includesMe ? myPct : null)
          : null,
        othersCount: Math.max(0, (stat?.attempts ?? 0) - (includesMe ? 1 : 0)),
      };
    });
}

// ── 문제지 오답노트 (과목 → 문제지 드릴다운) ───────────────────────────────

export type PaperWrongNoteRound = {
  attemptId: string;
  // 이 문제지를 몇 번째로 푼 기록인지 (1부터, 오래된 순 — "N회독"과 같은 기준).
  round: number;
  score: number;
  totalQuestions: number;
  createdAt: string;
  // 이 회독에서 틀린 문항과 그때 고른 답. 회독 필터가 그대로 그린다.
  wrong: { questionNumber: number; selectedChoice: number | null }[];
};

export type PaperWrongNote = {
  paper: WrongNotePaperInfo;
  rounds: PaperWrongNoteRound[];
  // 모든 회독을 합친 "통합" 문제 목록 (몇 번 틀렸는지/극복 여부 포함).
  questions: WrongNoteQuestionDetail[];
  unresolvedCount: number;
  resolvedCount: number;
};

// 문제지 오답노트 페이지용: 이 문제지에 대한 내 회독 기록 전체와, 통합 오답
// 목록(이미지·정답·해설 포함)을 돌려준다. 응시 기록이 없거나 문제지가 삭제됐으면 null.
//
// includeExplanations=false 면 해설 본문 없이 "해설이 있는 문항" 표시만 돌려준다
// (무료 회원 — getSubjectWrongNoteQuestions 와 같은 기준).
export async function getPaperWrongNote(
  supabase: Supabase,
  userId: string,
  paperId: string,
  includeExplanations = true,
): Promise<PaperWrongNote | null> {
  const { data: attemptRows } = await supabase
    .from("cbt_attempts")
    .select(ATTEMPT_SELECT)
    .eq("user_id", userId)
    .eq("paper_id", paperId)
    .order("created_at", { ascending: true });
  const attempts = (attemptRows ?? []) as unknown as WrongNoteAttemptRow[];
  const paper = attempts.find((a) => a.exam_papers)?.exam_papers;
  if (!paper) return null;

  const [wrongRows, marks, statusOverrides] = await Promise.all([
    fetchWrongAnswerRows(
      supabase,
      attempts.map((a) => a.id),
    ),
    fetchWrongNoteMarks(supabase, userId, [paperId]),
    fetchQuestionStatusMap(supabase, userId, [paperId]),
  ]);

  const wrongByAttempt = new Map<string, PaperWrongNoteRound["wrong"]>();
  for (const row of wrongRows) {
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push({
      questionNumber: row.question_number,
      selectedChoice: row.selected_choice,
    });
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

  // 오답이 하나도 없으면(전부 만점) 통합 목록은 비지만 회독 기록은 그대로 보여준다.
  // 응시가 전부 한 문제지 것이므로 결과는 과목 하나 → 문제지 하나로 좁혀진다.
  const group = buildWrongNoteGroups(attempts, wrongRows, marks.deleted, statusOverrides)[0]?.papers[0];
  if (!group) {
    return { paper, rounds, questions: [], unresolvedCount: 0, resolvedCount: 0 };
  }

  const [mediaByPaper, answersByPaper, explanationsByPaper, explainedByPaper] =
    await Promise.all([
      fetchQuestionMedia(supabase, [paper.id]),
      fetchCorrectAnswers([paper.id]),
      includeExplanations
        ? fetchExplanations([paper.id])
        : new Map<string, Map<number, QuestionExplanationContent>>(),
      includeExplanations
        ? new Map<string, Set<number>>()
        : fetchExplainedNumbers([paper.id]),
    ]);

  return {
    paper,
    rounds,
    questions: group.questions.map((q) =>
      toQuestionDetail(
        q,
        paper,
        mediaByPaper.get(paper.id),
        answersByPaper.get(paper.id),
        explanationsByPaper.get(paper.id),
        marks.pinned,
        explainedByPaper.get(paper.id),
      ),
    ),
    unresolvedCount: group.unresolvedCount,
    resolvedCount: group.resolvedCount,
  };
}

// ── 문제지 전체 해설 (상세페이지 "해설 열기") ─────────────────────────────
// 오답노트와 달리 응시 여부와 무관하게 공개로 보여준다. 정답지 PDF가 이미 공개
// 다운로드라 해설 공개가 새로운 정답 노출은 아니며, 상세페이지 버튼은 전 문항
// 해설이 준비된 문제지에만 열어준다(아래 count로 판단).

export async function countPaperExplanations(paperId: string): Promise<number> {
  const admin = createAdminClient();
  // fetchExplanations와 같은 이유로 embedded 필터를 쓰지 않는다 — 이 함수는 문제지
  // 상세페이지가 열릴 때마다 불려서(실측 1.9만 회) 느려지면 "해설 열기" 버튼이
  // 통째로 사라진다. 문항 id를 먼저 받고 그 id로 센다.
  try {
    const keys = await fetchQuestionKeys(admin, [paperId]);
    const questionIds = [...keys.keys()];
    if (questionIds.length === 0) return 0;

    // question_id는 unique라 행 하나 = 문항 하나다(문항 번호로 다시 셀 필요 없음).
    const counts = await inParallel(
      chunk(questionIds, QUESTION_ID_CHUNK),
      async (ids) => {
        const { count, error } = await admin
          .from("question_explanations")
          .select("question_id", { count: "exact", head: true })
          .in("question_id", ids);
        if (error) throw error;
        return count ?? 0;
      },
    );
    return counts.reduce((a, b) => a + b, 0);
  } catch (e) {
    // 실패를 0으로 돌려주면 "해설 열기"가 사라질 뿐이라 화면이 거짓말을 하진
    // 않지만, 조용히 넘어가면 원인을 못 찾으므로 로그는 남긴다.
    console.error("countPaperExplanations 실패", { paperId, error: e });
    return 0;
  }
}

export type PaperExplanationQuestion = {
  questionNumber: number;
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent;
};

// 해설이 등록된 문항만 번호순으로 돌려준다 (문항 이미지·정답 포함).
export async function getPaperExplanations(
  supabase: Supabase,
  paper: { id: string; choice_count: number },
): Promise<PaperExplanationQuestion[]> {
  const [mediaByPaper, answersByPaper, explanationsByPaper] = await Promise.all([
    fetchQuestionMedia(supabase, [paper.id]),
    fetchCorrectAnswers([paper.id]),
    // 이 화면은 해설이 곧 본문이라, 조회가 실패하면 빈 목록(=해설 없음) 대신
    // 에러로 알린다. 빈 목록은 "아직 해설이 등록되지 않은 문제지예요"로 그려진다.
    fetchExplanations([paper.id], undefined, true),
  ]);
  const media = mediaByPaper.get(paper.id);
  const answers = answersByPaper.get(paper.id);
  const explanations =
    explanationsByPaper.get(paper.id) ?? new Map<number, QuestionExplanationContent>();

  return [...explanations.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([questionNumber, explanation]) => {
      const entry = media?.get(questionNumber);
      return {
        questionNumber,
        correctChoice: answers?.[questionNumber - 1] ?? null,
        choiceCount: entry?.choiceCount ?? paper.choice_count,
        images: entry?.images ?? [],
        explanation,
      };
    });
}

// 회차(응시) 오답노트 페이지용 데이터.
export type AttemptWrongNote = {
  attempt: {
    id: string;
    score: number;
    totalQuestions: number;
    durationSeconds: number | null;
    createdAt: string;
    // 이 문제지를 몇 번째로 푼 기록인지 (마이페이지 "N회독" 배지와 같은 기준).
    round: number;
  };
  paper: WrongNotePaperInfo | null;
  questions: {
    questionNumber: number;
    selectedChoice: number | null;
    correctChoice: number | null;
    choiceCount: number;
    images: string[];
    explanation: QuestionExplanationContent | null;
    // 해설은 있지만 무료 회원이라 본문을 받지 않은 문항(화면은 잠금 자리를 그린다).
    explanationLocked: boolean;
  }[];
};

// includeExplanations=false 면 해설 본문을 아예 조회하지 않고, 해설이 있는 문항인지만
// 표시해 준다. 응시 기록 상세는 무료 회원도 보는 화면이라(점수·틀린 문항 확인은 CBT의
// 일부다) 화면 자체는 남기되, 해설 본문만 빼서 "무료는 하루 문제지 3개"라는 한도가 이
// 경로로 새지 않게 한다.
export async function getAttemptWrongNote(
  supabase: Supabase,
  userId: string,
  attemptId: string,
  includeExplanations = true,
): Promise<AttemptWrongNote | null> {
  const { data: attemptRow } = await supabase
    .from("cbt_attempts")
    .select(
      "id, paper_id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, round, track, choice_count, subjects(*), exam_types(*))",
    )
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!attemptRow) return null;

  const attempt = attemptRow as unknown as {
    id: string;
    paper_id: string;
    score: number;
    total_questions: number;
    duration_seconds: number | null;
    created_at: string;
    exam_papers: WrongNotePaperInfo | null;
  };

  const [{ data: wrongRows }, { count: earlierCount }] = await Promise.all([
    supabase
      .from("cbt_attempt_answers")
      .select("question_number, selected_choice")
      .eq("attempt_id", attempt.id)
      .eq("is_correct", false)
      .order("question_number"),
    supabase
      .from("cbt_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("paper_id", attempt.paper_id)
      .lte("created_at", attempt.created_at),
  ]);

  const wrong = (wrongRows ?? []) as {
    question_number: number;
    selected_choice: number | null;
  }[];

  // 문제지가 삭제됐으면 이미지·정답·해설 없이 번호/선택지만 보여준다.
  const paper = attempt.exam_papers;
  const [mediaByPaper, answersByPaper, explanationsByPaper, explainedByPaper] =
    paper && wrong.length > 0
      ? await Promise.all([
          fetchQuestionMedia(supabase, [paper.id]),
          fetchCorrectAnswers([paper.id]),
          includeExplanations
            ? fetchExplanations([paper.id])
            : new Map<string, Map<number, QuestionExplanationContent>>(),
          includeExplanations
            ? new Map<string, Set<number>>()
            : fetchExplainedNumbers([paper.id]),
        ])
      : [
          new Map<string, Map<number, QuestionMediaEntry>>(),
          new Map<string, number[]>(),
          new Map<string, Map<number, QuestionExplanationContent>>(),
          new Map<string, Set<number>>(),
        ];

  const media = paper ? mediaByPaper.get(paper.id) : undefined;
  const answers = paper ? answersByPaper.get(paper.id) : undefined;
  const explanations = paper ? explanationsByPaper.get(paper.id) : undefined;
  const explained = paper ? explainedByPaper.get(paper.id) : undefined;

  return {
    attempt: {
      id: attempt.id,
      score: attempt.score,
      totalQuestions: attempt.total_questions,
      durationSeconds: attempt.duration_seconds,
      createdAt: attempt.created_at,
      round: earlierCount ?? 1,
    },
    paper,
    questions: wrong.map((row) => {
      const entry = media?.get(row.question_number);
      return {
        questionNumber: row.question_number,
        selectedChoice: row.selected_choice,
        correctChoice: answers?.[row.question_number - 1] ?? null,
        choiceCount: entry?.choiceCount ?? paper?.choice_count ?? 4,
        images: entry?.images ?? [],
        explanation: explanations?.get(row.question_number) ?? null,
        explanationLocked: explained?.has(row.question_number) ?? false,
      };
    }),
  };
}
