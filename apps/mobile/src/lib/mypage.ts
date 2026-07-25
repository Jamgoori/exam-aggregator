import { supabase } from "./supabase";
import { publicUrl } from "./storage";
import { getPaperDisplayTitle, type ExamPaper } from "@gongmoa/core";

// 마이페이지 데이터. RLS 로 본인 행만 읽힌다(cbt_attempts / bookmarks /
// user_question_status 모두 user_id = auth.uid() 정책). 웹 mypage 의 앱 최소판.

export type MyAttempt = {
  id: string;
  score: number;
  total_questions: number;
  duration_seconds: number | null;
  created_at: string;
  paper: { id: string; title: string; level: string | null } | null;
};

export async function getMyAttempts(): Promise<MyAttempt[]> {
  const { data, error } = await supabase
    .from("cbt_attempts")
    .select(
      "id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, track)",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r) => {
    type PaperRow = {
      id: string;
      title: string;
      level: string | null;
      track: string | null;
    };
    const p = r.exam_papers as PaperRow | PaperRow[] | null;
    // PostgREST 는 관계를 단일/배열 어느 쪽으로도 줄 수 있어 방어적으로 편다.
    const row = Array.isArray(p) ? (p[0] ?? null) : p;
    // MyAttempt.paper.title 은 화면에 그대로 그려지는 값이라 웹과 같은 표시 규칙을 적용한다.
    const paper = row
      ? {
          id: row.id,
          title: getPaperDisplayTitle(row.title, row.track),
          level: row.level,
        }
      : null;
    return {
      id: r.id as string,
      score: r.score as number,
      total_questions: r.total_questions as number,
      duration_seconds: r.duration_seconds as number | null,
      created_at: r.created_at as string,
      paper,
    };
  });
}

// 같은 문제지를 몇 번째 풀었는지(N회독). 웹 computeAttemptRounds 와 동일 규칙.
export function computeAttemptRounds(attempts: MyAttempt[]): Map<string, number> {
  const byPaper = new Map<string, MyAttempt[]>();
  for (const a of attempts) {
    if (!a.paper) continue;
    const list = byPaper.get(a.paper.id) ?? [];
    list.push(a);
    byPaper.set(a.paper.id, list);
  }
  const roundByAttempt = new Map<string, number>();
  for (const list of byPaper.values()) {
    [...list]
      .sort(
        (x, y) =>
          new Date(x.created_at).getTime() - new Date(y.created_at).getTime(),
      )
      .forEach((a, i) => roundByAttempt.set(a.id, i + 1));
  }
  return roundByAttempt;
}

export async function getMyBookmarks(): Promise<ExamPaper[]> {
  const { data, error } = await supabase
    .from("bookmarks")
    .select(
      "created_at, exam_papers(id, title, year, round, level, track, subjects(id, name, slug))",
    )
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? [])
    .map((r) => {
      const p = r.exam_papers as unknown as ExamPaper | ExamPaper[] | null;
      return Array.isArray(p) ? (p[0] ?? null) : p;
    })
    .filter((p): p is ExamPaper => p !== null);
}

// 과목별 "남은 오답" 요약은 lib/wrong-notes.ts 로 옮겼다. 예전엔 user_question_status 만
// 보는 근사치라 웹 숫자와 어긋났는데, 지금은 @gongmoa/core 의 buildWrongNoteGroups(웹과
// 같은 집계)를 쓴다. 타입 이름은 쓰던 곳이 있어 재노출한다.
export type { WrongNoteSubjectSummary as WrongNoteSubject } from "./wrong-notes";

// ── 응시 상세 (한 응시의 문항별 정/오답) ──────────────────────────────────────
export type AttemptQuestion = {
  questionNumber: number;
  images: string[];
  selectedChoice: number | null;
  isCorrect: boolean;
};

export type AttemptDetail = {
  title: string;
  score: number;
  totalQuestions: number;
  createdAt: string;
  questions: AttemptQuestion[];
};

export async function getAttemptDetail(attemptId: string): Promise<AttemptDetail | null> {
  const { data: attempt } = await supabase
    .from("cbt_attempts")
    .select("id, paper_id, score, total_questions, created_at, exam_papers(title, track)")
    .eq("id", attemptId)
    .maybeSingle();
  if (!attempt) return null;

  type PaperRow = { title: string; track: string | null };
  const ep = attempt.exam_papers as PaperRow | PaperRow[] | null;
  const paperRow = Array.isArray(ep) ? (ep[0] ?? null) : ep;
  const title = paperRow
    ? getPaperDisplayTitle(paperRow.title, paperRow.track)
    : "삭제된 문제";
  const paperId = attempt.paper_id as string;

  const [{ data: answerRows }, { data: questionRows }] = await Promise.all([
    supabase
      .from("cbt_attempt_answers")
      .select("question_number, selected_choice, is_correct")
      .eq("attempt_id", attemptId)
      .order("question_number"),
    supabase
      .from("questions")
      .select("question_number, question_images(order_index, image_path)")
      .eq("paper_id", paperId),
  ]);

  const imageMap = new Map<number, string[]>();
  for (const q of questionRows ?? []) {
    const imgs = [...((q.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => publicUrl(img.image_path));
    imageMap.set(q.question_number as number, imgs);
  }

  const questions: AttemptQuestion[] = (answerRows ?? []).map((r) => ({
    questionNumber: r.question_number as number,
    images: imageMap.get(r.question_number as number) ?? [],
    selectedChoice: r.selected_choice as number | null,
    isCorrect: r.is_correct as boolean,
  }));

  return {
    title,
    score: attempt.score as number,
    totalQuestions: attempt.total_questions as number,
    createdAt: attempt.created_at as string,
    questions,
  };
}
