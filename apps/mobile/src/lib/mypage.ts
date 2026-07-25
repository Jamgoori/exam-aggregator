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

export type WrongNoteSubject = {
  subjectId: string;
  name: string;
  slug: string;
  unresolved: number;
};

// 과목별 "남은 오답" 요약 — user_question_status 에서 마지막 제출이 오답인 문항 수.
//
// ⚠️ 웹은 dedup(중복 시험지)·수동 표시(wrong_note_marks)·복습 쿨다운까지 반영한
// 권위 있는 집계를 쓴다(getUnresolvedCountBySubject). 이 앱 버전은 그걸 단순화한
// 근사치라 웹 숫자와 미세하게 다를 수 있다 — 상세는 웹에서.
export async function getWrongNoteSubjects(): Promise<WrongNoteSubject[]> {
  const { data, error } = await supabase
    .from("user_question_status")
    .select("paper_id, exam_papers(subject_id, subjects(id, name, slug))")
    .gt("wrong_count", 0)
    .eq("last_is_correct", false);
  if (error) throw error;

  const bySubject = new Map<string, WrongNoteSubject>();
  for (const row of data ?? []) {
    // 조인 결과를 supabase-js 는 배열로 추론하지만 to-one 관계라 실제로는 객체로 온다.
    // 둘 다 들어올 수 있다고 보고 아래에서 풀기 때문에, 추론 타입과 겹치지 않는 이
    // 캐스트는 unknown 을 한 번 거친다(TS2352).
    const ep = row.exam_papers as unknown as
      | { subjects: { id: string; name: string; slug: string } | null }
      | { subjects: { id: string; name: string; slug: string } | null }[]
      | null;
    const paper = Array.isArray(ep) ? ep[0] : ep;
    const subj = paper?.subjects;
    const s = Array.isArray(subj) ? subj[0] : subj;
    if (!s) continue;
    const cur = bySubject.get(s.id) ?? {
      subjectId: s.id,
      name: s.name,
      slug: s.slug,
      unresolved: 0,
    };
    cur.unresolved += 1;
    bySubject.set(s.id, cur);
  }
  return [...bySubject.values()].sort((a, b) => b.unresolved - a.unresolved);
}

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

// ── 오답노트 상세 (과목 → 문제지별 틀린 문항) ──────────────────────────────────
// 정답은 RLS 로 클라이언트에 안 보인다(커닝 방지). 그래서 상세는 "틀린 문항 이미지 +
// 극복 여부 + 다시 풀기"만 보여준다 — 정답 확인/재채점은 CBT 로 다시 풀 때 서버가 한다.

export type WrongNoteQuestion = {
  questionNumber: number;
  images: string[];
  resolved: boolean; // 마지막 제출이 정답이면 극복
};

export type WrongNotePaperGroup = {
  paperId: string;
  title: string;
  questions: WrongNoteQuestion[];
};

export type WrongNoteDetail = {
  subjectName: string;
  groups: WrongNotePaperGroup[];
};

export async function getWrongNoteDetail(
  slug: string,
): Promise<WrongNoteDetail | null> {
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, name, slug")
    .eq("slug", slug)
    .maybeSingle();
  if (!subject) return null;

  // 이 과목의 문제지 중 내가 틀린 문항(wrong_count>0). exam_papers!inner 로 과목 필터.
  const { data: statusRows, error } = await supabase
    .from("user_question_status")
    .select(
      "paper_id, question_number, last_is_correct, exam_papers!inner(id, title, track, subject_id)",
    )
    .eq("exam_papers.subject_id", subject.id)
    .gt("wrong_count", 0);
  if (error) throw error;

  type PaperRow = { id: string; title: string; track: string | null };
  type Row = {
    paper_id: string;
    question_number: number;
    last_is_correct: boolean;
    exam_papers: PaperRow | PaperRow[];
  };
  const rows = (statusRows ?? []) as Row[];
  if (rows.length === 0) {
    return { subjectName: subject.name as string, groups: [] };
  }

  // 틀린 문항들의 이미지 조회: questions(paper_id, question_number) → question_images.
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];
  const { data: questionRows } = await supabase
    .from("questions")
    .select("paper_id, question_number, question_images(order_index, image_path)")
    .in("paper_id", paperIds);

  const imageMap = new Map<string, string[]>(); // key: `${paperId}:${qnum}`
  for (const q of questionRows ?? []) {
    const imgs = [...((q.question_images as
      | { order_index: number; image_path: string }[]
      | null) ?? [])]
      .sort((a, b) => a.order_index - b.order_index)
      .map((img) => publicUrl(img.image_path));
    imageMap.set(`${q.paper_id}:${q.question_number}`, imgs);
  }

  // 문제지별 그룹화.
  const groupMap = new Map<string, WrongNotePaperGroup>();
  for (const r of rows) {
    const ep = Array.isArray(r.exam_papers) ? r.exam_papers[0] : r.exam_papers;
    if (!ep) continue;
    const group = groupMap.get(r.paper_id) ?? {
      paperId: r.paper_id,
      title: getPaperDisplayTitle(ep.title, ep.track),
      questions: [],
    };
    group.questions.push({
      questionNumber: r.question_number,
      images: imageMap.get(`${r.paper_id}:${r.question_number}`) ?? [],
      resolved: r.last_is_correct === true,
    });
    groupMap.set(r.paper_id, group);
  }

  const groups = [...groupMap.values()].map((g) => ({
    ...g,
    questions: g.questions.sort((a, b) => a.questionNumber - b.questionNumber),
  }));

  return { subjectName: subject.name as string, groups };
}
