import type { SupabaseClient } from "@supabase/supabase-js";
import type { WrongNotePaperInfo } from "../wrong-notes";
import { fetchQuestionMedia } from "./question-media";

// 내 CBT 응시 기록(DI) — 웹 app/mypage/page.tsx 의 응시 조회·"N회독" 계산과
// lib/wrong-notes.ts#getAttemptWrongNote 의 응시 상세를 옮긴 것(설계서 §6.2 CBT 시작/제출 행,
// §5 `/mypage`·`/mypage/attempts/[attemptId]`). cbt_attempts·cbt_attempt_answers 는 select-own
// RLS 라 사용자 세션 클라이언트로 충분하다.
//
// 정답은 여기 없다. 웹은 service_role 로 paper_answers 를 읽지만(fetchCorrectAnswers) 앱은
// RPC own_wrong_answers(data/wrong-answers.ts)로 본인이 답한 문항의 정답만 따로 받고, 그 결과는
// 디스크에 남기지 않는다(AGENTS.md 금지선). 이 파일의 결과(내 선택·정오·이미지)는 퍼시스트해도 된다.

// 마이페이지 응시 목록 행 — 웹 mypage/page.tsx 의 MyAttempt 와 같은 모양.
export type MyAttemptRow = {
  id: string;
  score: number;
  total_questions: number;
  duration_seconds: number | null;
  created_at: string;
  exam_papers: WrongNotePaperInfo | null;
};

export const MY_ATTEMPTS_SELECT =
  "id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, round, track, choice_count, subjects(*), exam_types(*))";

// 전체를 최신순으로. 개인 응시 수는 수백 건 수준이라 웹처럼 한 번에 받는다.
export async function fetchMyAttempts(client: SupabaseClient, userId: string): Promise<MyAttemptRow[]> {
  const { data, error } = await client
    .from("cbt_attempts")
    .select(MY_ATTEMPTS_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`응시 기록 조회 실패: ${error.message}`);
  return (data ?? []) as unknown as MyAttemptRow[];
}

// 같은 문제지를 몇 번째 풀었는지("N회독") 계산. myAttempts는 전체를 최신순으로 이미
// 받아왔으므로, 문제지별로 묶어 오래된 순으로 다시 정렬해 순번을 매긴다.
// (웹 app/mypage/page.tsx 에 있던 순수 함수 — 웹·앱이 같은 회독 번호를 붙이도록 여기로.)
export function computeAttemptRounds<T extends Pick<MyAttemptRow, "id" | "created_at"> & { exam_papers: { id: string } | null }>(
  myAttempts: T[],
): { attemptsByPaper: Map<string, T[]>; roundNumberByAttemptId: Map<string, number> } {
  const attemptsByPaper = new Map<string, T[]>();
  for (const a of myAttempts) {
    if (!a.exam_papers) continue;
    const list = attemptsByPaper.get(a.exam_papers.id) ?? [];
    list.push(a);
    attemptsByPaper.set(a.exam_papers.id, list);
  }
  const roundNumberByAttemptId = new Map<string, number>();
  for (const list of attemptsByPaper.values()) {
    [...list]
      .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime())
      .forEach((a, i) => roundNumberByAttemptId.set(a.id, i + 1));
  }
  return { attemptsByPaper, roundNumberByAttemptId };
}

// ── 응시 상세(/mypage/attempts/[attemptId]) ──────────────────────────────────

export type AttemptDetailQuestion = {
  questionNumber: number;
  selectedChoice: number | null;
  isCorrect: boolean;
  choiceCount: number;
  images: string[];
};

export type AttemptDetail = {
  attempt: {
    id: string;
    paperId: string;
    score: number;
    totalQuestions: number;
    durationSeconds: number | null;
    createdAt: string;
    // 이 문제지를 몇 번째로 푼 기록인지 (마이페이지 "N회독" 배지와 같은 기준).
    round: number;
  };
  paper: WrongNotePaperInfo | null;
  // 문항 번호 오름차순, 맞힌 문항 포함(화면이 "틀린 문항만/전체"를 고른다 — 웹은 틀린 것만 받는다).
  questions: AttemptDetailQuestion[];
};

// 본인 응시가 아니면 RLS 가 빈 결과를 주므로 null(화면은 404). 정답·해설은 싣지 않는다.
export async function fetchAttemptDetail(
  client: SupabaseClient,
  userId: string,
  attemptId: string,
): Promise<AttemptDetail | null> {
  const { data: attemptRow, error } = await client
    .from("cbt_attempts")
    .select(`paper_id, ${MY_ATTEMPTS_SELECT}`)
    .eq("id", attemptId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`응시 기록 조회 실패: ${error.message}`);
  if (!attemptRow) return null;

  const attempt = attemptRow as unknown as MyAttemptRow & { paper_id: string };

  const [{ data: answerRows, error: answersError }, { count: earlierCount }] = await Promise.all([
    client
      .from("cbt_attempt_answers")
      .select("question_number, selected_choice, is_correct")
      .eq("attempt_id", attempt.id)
      .order("question_number"),
    client
      .from("cbt_attempts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("paper_id", attempt.paper_id)
      .lte("created_at", attempt.created_at),
  ]);
  if (answersError) throw new Error(`응시 기록 조회 실패: ${answersError.message}`);

  const answers = (answerRows ?? []) as { question_number: number; selected_choice: number | null; is_correct: boolean }[];
  const paper = attempt.exam_papers;
  // 문제지가 삭제됐으면 이미지 없이 번호/선택지만 보여준다(웹과 동일).
  const media = paper && answers.length > 0 ? (await fetchQuestionMedia(client, [paper.id])).get(paper.id) : undefined;

  return {
    attempt: {
      id: attempt.id,
      paperId: attempt.paper_id,
      score: attempt.score,
      totalQuestions: attempt.total_questions,
      durationSeconds: attempt.duration_seconds,
      createdAt: attempt.created_at,
      round: earlierCount ?? 1,
    },
    paper,
    questions: answers.map((row) => {
      const entry = media?.get(row.question_number);
      return {
        questionNumber: row.question_number,
        selectedChoice: row.selected_choice,
        isCorrect: row.is_correct,
        choiceCount: entry?.choiceCount ?? paper?.choice_count ?? 4,
        images: entry?.images ?? [],
      };
    }),
  };
}
