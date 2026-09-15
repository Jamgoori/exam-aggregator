import type { SupabaseClient } from "@supabase/supabase-js";
import { chunk } from "../format";
import type { WrongNoteMarks } from "../wrong-notes";
import { inParallel } from "./query-utils";
import {
  toExplanationContent,
  type ExplanationRow,
  type QuestionExplanationContent,
} from "../rules/explanations";

// 오답노트 조회 계층 중 복습·섞어풀기 규칙(rules/review-session·review-queue·
// mix-practice)이 함께 쓰는 것 — 웹 lib/wrong-notes.ts 에서 옮겼다(설계서 §6.8
// `data/wrong-notes.ts`). 웹 파일은 같은 이름으로 재노출하고, service_role 이 필요한
// 조회에는 createAdminClient() 를 만들어 넘긴다.
//
// client  — 본인 행만 읽으면 되는 조회(wrong_note_marks·question_memos, select-own RLS).
//           웹은 사용자 세션 클라이언트, Edge 는 admin(호출부가 userId 를 검증한 뒤).
// admin   — paper_answers·question_explanations 처럼 RLS 로 잠긴 테이블. 반드시
//           "본인이 응시한 문제지"로 좁힌 뒤 부를 것(정답·해설이 실린다).

// 복습 대상(간격 반복 lite): 미극복 오답 중 마지막으로 푼 지 이만큼 지난 문항을
// "오늘 복습할 것"으로 본다. 별도 컬럼 없이 last_answered_at로 파생한다.
export const REVIEW_COOLDOWN_HOURS = 24;

export async function fetchWrongNoteMarks(
  client: SupabaseClient,
  userId: string,
  paperIds?: string[],
): Promise<WrongNoteMarks> {
  const deleted = new Set<string>();
  const pinned = new Set<string>();
  if (paperIds && paperIds.length === 0) return { deleted, pinned };

  const idChunks: (string[] | null)[] = paperIds ? chunk(paperIds, 200) : [null];
  const failed = await inParallel(idChunks, async (ids) => {
    let query = client
      .from("wrong_note_marks")
      .select("paper_id, question_number, pinned, deleted")
      .eq("user_id", userId);
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    if (error) return true;
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      pinned: boolean | null;
      deleted: boolean | null;
    }[]) {
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

// 문제지별 정답 배열. paper_answers는 정답 유출 방지를 위해 일반 select가 막혀 있어
// service role로만 읽는다 — 반드시 "본인 응시 기록이 있는 문제지"로 좁힌 뒤 호출할 것.
// (오답노트는 이미 응시를 마친 문제지만 다루고, 정답지 PDF도 공개 다운로드라
// 응시자 본인에게 문항 정답을 보여주는 건 새로운 노출이 아니다.)
export async function fetchCorrectAnswers(
  admin: SupabaseClient,
  paperIds: string[],
): Promise<Map<string, number[]>> {
  const byPaper = new Map<string, number[]>();
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, answers")
      .in("paper_id", ids);
    for (const row of (data ?? []) as { paper_id: string; answers: number[] | null }[]) {
      byPaper.set(row.paper_id, row.answers ?? []);
    }
  });
  return byPaper;
}

// 문항 메모(본인 것만, RLS). `${paperId}#${qnum}` → 메모.
export async function fetchMemos(
  client: SupabaseClient,
  userId: string,
  paperIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paperIds.length === 0) return out;
  await inParallel(chunk(paperIds, 200), async (ids) => {
    const { data } = await client
      .from("question_memos")
      .select("paper_id, question_number, memo")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of (data ?? []) as {
      paper_id: string;
      question_number: number;
      memo: string | null;
    }[]) {
      const memo = r.memo?.trim();
      if (memo) out.set(`${r.paper_id}#${r.question_number}`, memo);
    }
  });
  return out;
}

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
export const QUESTION_ID_CHUNK = 200;

// PostgREST 기본 최대 행 수.
const BATCH_SIZE = 1000;

type QuestionKey = { paperId: string; questionNumber: number };

// 문제지들의 문항 id ↔ (문제지, 문항번호) 대응표. questions는 public read라
// service role로도 그대로 읽힌다. wanted를 주면 그 문항 번호로 좁힌다.
// (웹 countPaperExplanations 도 이 대응표로 문항 id 를 먼저 받아 센다.)
export async function fetchQuestionKeys(
  admin: SupabaseClient,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, QuestionKey>> {
  const byId = new Map<string, QuestionKey>();
  type Row = { id: string; paper_id: string; question_number: number };

  function consume(rows: Row[]) {
    for (const row of rows) {
      byId.set(row.id, { paperId: row.paper_id, questionNumber: row.question_number });
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
  admin: SupabaseClient,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
  required = false,
): Promise<Map<string, Map<number, QuestionExplanationContent>>> {
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
  admin: SupabaseClient,
  paperIds: string[],
  wanted?: Map<string, Set<number>>,
): Promise<Map<string, Set<number>>> {
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
