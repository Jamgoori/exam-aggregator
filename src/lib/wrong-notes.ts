import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExamType, Subject } from "@/lib/supabase/types";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 오답노트 화면들이 exam_papers에서 실제로 쓰는 필드만 추린 형태.
export type WrongNotePaperInfo = {
  id: string;
  title: string;
  level: string | null;
  choice_count: number;
  subjects: Subject | null;
  exam_types: ExamType | null;
};

// 오답노트 집계에 필요한 최소한의 응시 행. 마이페이지처럼 이미 응시 목록을
// 들고 있는 호출부는 그 데이터를 그대로 넘겨 재조회를 피할 수 있다.
export type WrongNoteAttemptRow = {
  id: string;
  created_at: string;
  exam_papers: WrongNotePaperInfo | null;
};

// 문제 하나가 응시 이력 전체에서 어떻게 틀렸는지 요약한 값.
export type WrongNoteQuestionSummary = {
  questionNumber: number;
  // 여러 번 응시했으면 틀릴 때마다 1씩 늘어난다 ("2번 틀림" 배지용).
  wrongCount: number;
  // 이 문제지의 가장 최근 응시에서는 맞혔는지 ("극복" 배지/필터용).
  resolved: boolean;
  // 가장 최근에 틀렸을 때 고른 답 (null이면 풀지 않고 넘어간 문제).
  lastSelectedChoice: number | null;
};

export type WrongNotePaperGroup = {
  paper: WrongNotePaperInfo;
  attemptCount: number;
  lastAttemptAt: string;
  questions: WrongNoteQuestionSummary[];
  unresolvedCount: number;
  resolvedCount: number;
};

export type WrongNoteSubjectGroup = {
  subject: Subject;
  papers: WrongNotePaperGroup[];
  unresolvedCount: number;
  resolvedCount: number;
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type WrongAnswerRow = {
  attempt_id: string;
  question_number: number;
  selected_choice: number | null;
};

// PostgREST는 range() 없이는 한 번에 최대 1000행만 돌려주므로(cbt-availability.ts와
// 같은 이유), 응시가 많은 사용자도 오답이 잘리지 않게 끝까지 이어받는다.
const BATCH_SIZE = 1000;

export async function fetchWrongAnswerRows(
  supabase: Supabase,
  attemptIds: string[],
): Promise<WrongAnswerRow[]> {
  const rows: WrongAnswerRow[] = [];
  for (const ids of chunk(attemptIds, 100)) {
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
  }
  return rows;
}

// 응시 목록 + 오답 행을 과목 → 문제지 → 문제 순으로 묶는다. "몇 번 틀렸는지"와
// "가장 최근 응시에서는 맞혔는지(극복)"까지 여기서 한 번에 계산해서, 화면들은
// 이 결과를 그대로 그리기만 하면 된다.
export function buildWrongNoteGroups(
  attempts: WrongNoteAttemptRow[],
  wrongRows: WrongAnswerRow[],
): WrongNoteSubjectGroup[] {
  const wrongByAttempt = new Map<string, WrongAnswerRow[]>();
  for (const row of wrongRows) {
    const list = wrongByAttempt.get(row.attempt_id) ?? [];
    list.push(row);
    wrongByAttempt.set(row.attempt_id, list);
  }

  // 문제지가 삭제된 응시는 문제 이미지도 정답도 보여줄 수 없으므로 집계에서 뺀다.
  const attemptsByPaper = new Map<string, WrongNoteAttemptRow[]>();
  for (const a of attempts) {
    if (!a.exam_papers) continue;
    const list = attemptsByPaper.get(a.exam_papers.id) ?? [];
    list.push(a);
    attemptsByPaper.set(a.exam_papers.id, list);
  }

  const paperGroups: WrongNotePaperGroup[] = [];
  for (const list of attemptsByPaper.values()) {
    const sorted = [...list].sort(
      (x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime(),
    );
    const latest = sorted[0];
    const wrongInLatest = new Set(
      (wrongByAttempt.get(latest.id) ?? []).map((r) => r.question_number),
    );

    // 최신 응시부터 훑으므로, 문제를 처음 만났을 때의 선택지가 "가장 최근에 고른 답"이 된다.
    const byNumber = new Map<number, WrongNoteQuestionSummary>();
    for (const attempt of sorted) {
      for (const row of wrongByAttempt.get(attempt.id) ?? []) {
        const existing = byNumber.get(row.question_number);
        if (existing) {
          existing.wrongCount++;
        } else {
          byNumber.set(row.question_number, {
            questionNumber: row.question_number,
            wrongCount: 1,
            resolved: !wrongInLatest.has(row.question_number),
            lastSelectedChoice: row.selected_choice,
          });
        }
      }
    }
    if (byNumber.size === 0) continue;

    const questions = [...byNumber.values()].sort(
      (a, b) => a.questionNumber - b.questionNumber,
    );
    const unresolvedCount = questions.filter((q) => !q.resolved).length;
    paperGroups.push({
      paper: latest.exam_papers!,
      attemptCount: sorted.length,
      lastAttemptAt: latest.created_at,
      questions,
      unresolvedCount,
      resolvedCount: questions.length - unresolvedCount,
    });
  }

  const bySubject = new Map<string, WrongNoteSubjectGroup>();
  for (const group of paperGroups) {
    const subject = group.paper.subjects;
    if (!subject) continue;
    const existing = bySubject.get(subject.id);
    if (existing) {
      existing.papers.push(group);
      existing.unresolvedCount += group.unresolvedCount;
      existing.resolvedCount += group.resolvedCount;
    } else {
      bySubject.set(subject.id, {
        subject,
        papers: [group],
        unresolvedCount: group.unresolvedCount,
        resolvedCount: group.resolvedCount,
      });
    }
  }

  const groups = [...bySubject.values()];
  for (const g of groups) {
    g.papers.sort(
      (a, b) => new Date(b.lastAttemptAt).getTime() - new Date(a.lastAttemptAt).getTime(),
    );
  }
  groups.sort(
    (a, b) =>
      a.subject.display_order - b.subject.display_order ||
      a.subject.name.localeCompare(b.subject.name, "ko"),
  );
  return groups;
}

const ATTEMPT_SELECT =
  "id, created_at, exam_papers(id, title, level, choice_count, subjects(*), exam_types(*))";

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

  const wrongRows = await fetchWrongAnswerRows(
    supabase,
    attempts.map((a) => a.id),
  );
  return buildWrongNoteGroups(attempts, wrongRows);
}

// 화면에 그릴 수 있게 이미지/정답까지 붙인 문제 상세.
export type WrongNoteQuestionDetail = WrongNoteQuestionSummary & {
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
};

export type WrongNotePaperDetail = Omit<WrongNotePaperGroup, "questions"> & {
  questions: WrongNoteQuestionDetail[];
};

type QuestionMediaEntry = { choiceCount: number | null; images: string[] };

// 문제지들의 문항별 크롭 이미지(공개 URL)와 선지 수를 한 번에 받아온다.
// questions/question_images는 public read라 사용자 세션 클라이언트로 충분하다.
async function fetchQuestionMedia(
  supabase: Supabase,
  paperIds: string[],
): Promise<Map<string, Map<number, QuestionMediaEntry>>> {
  const byPaper = new Map<string, Map<number, QuestionMediaEntry>>();

  for (const ids of chunk(paperIds, 10)) {
    let from = 0;
    while (true) {
      const { data } = await supabase
        .from("questions")
        .select(
          "paper_id, question_number, choice_count, question_images(order_index, image_path)",
        )
        .in("paper_id", ids)
        .order("paper_id")
        .order("question_number")
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;

      for (const row of data) {
        const images = [...(row.question_images ?? [])]
          .sort((a, b) => a.order_index - b.order_index)
          .map(
            (img) =>
              supabase.storage.from("exam-papers").getPublicUrl(img.image_path)
                .data.publicUrl,
          );
        const paperMap = byPaper.get(row.paper_id) ?? new Map();
        paperMap.set(row.question_number, {
          choiceCount: row.choice_count,
          images,
        });
        byPaper.set(row.paper_id, paperMap);
      }
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
  }
  return byPaper;
}

// 문제지별 정답 배열. paper_answers는 정답 유출 방지를 위해 일반 select가 막혀 있어
// service role로만 읽는다 — 반드시 "본인 응시 기록이 있는 문제지"로 좁힌 뒤 호출할 것.
// (오답노트는 이미 응시를 마친 문제지만 다루고, 정답지 PDF도 공개 다운로드라
// 응시자 본인에게 문항 정답을 보여주는 건 새로운 노출이 아니다.)
async function fetchCorrectAnswers(
  paperIds: string[],
): Promise<Map<string, number[]>> {
  const admin = createAdminClient();
  const byPaper = new Map<string, number[]>();
  for (const ids of chunk(paperIds, 200)) {
    const { data } = await admin
      .from("paper_answers")
      .select("paper_id, answers")
      .in("paper_id", ids);
    for (const row of data ?? []) {
      byPaper.set(row.paper_id as string, (row.answers ?? []) as number[]);
    }
  }
  return byPaper;
}

function toQuestionDetail(
  q: WrongNoteQuestionSummary,
  paper: WrongNotePaperInfo,
  media: Map<number, QuestionMediaEntry> | undefined,
  answers: number[] | undefined,
): WrongNoteQuestionDetail {
  const entry = media?.get(q.questionNumber);
  return {
    ...q,
    correctChoice: answers?.[q.questionNumber - 1] ?? null,
    choiceCount: entry?.choiceCount ?? paper.choice_count,
    images: entry?.images ?? [],
  };
}

// 과목 오답노트 페이지용: 해당 과목에서 틀려본 문제 전체를 문제지별로 묶고,
// 문항 이미지와 정답까지 붙여서 돌려준다. 과목 slug가 존재하지 않으면 null.
export async function getSubjectWrongNote(
  supabase: Supabase,
  userId: string,
  slug: string,
): Promise<{ subject: Subject; papers: WrongNotePaperDetail[] } | null> {
  const { data: subjectRow } = await supabase
    .from("subjects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!subjectRow) return null;
  const subject = subjectRow as Subject;

  const groups = await getWrongNoteGroups(supabase, userId);
  const group = groups.find((g) => g.subject.id === subject.id);
  if (!group) return { subject, papers: [] };

  const paperIds = group.papers.map((p) => p.paper.id);
  const [mediaByPaper, answersByPaper] = await Promise.all([
    fetchQuestionMedia(supabase, paperIds),
    fetchCorrectAnswers(paperIds),
  ]);

  const papers: WrongNotePaperDetail[] = group.papers.map((p) => ({
    ...p,
    questions: p.questions.map((q) =>
      toQuestionDetail(
        q,
        p.paper,
        mediaByPaper.get(p.paper.id),
        answersByPaper.get(p.paper.id),
      ),
    ),
  }));

  return { subject, papers };
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
  }[];
};

export async function getAttemptWrongNote(
  supabase: Supabase,
  userId: string,
  attemptId: string,
): Promise<AttemptWrongNote | null> {
  const { data: attemptRow } = await supabase
    .from("cbt_attempts")
    .select(
      "id, paper_id, score, total_questions, duration_seconds, created_at, exam_papers(id, title, level, choice_count, subjects(*), exam_types(*))",
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

  // 문제지가 삭제됐으면 이미지·정답 없이 번호/선택지만 보여준다.
  const paper = attempt.exam_papers;
  const [mediaByPaper, answersByPaper] =
    paper && wrong.length > 0
      ? await Promise.all([
          fetchQuestionMedia(supabase, [paper.id]),
          fetchCorrectAnswers([paper.id]),
        ])
      : [new Map<string, Map<number, QuestionMediaEntry>>(), new Map<string, number[]>()];

  const media = paper ? mediaByPaper.get(paper.id) : undefined;
  const answers = paper ? answersByPaper.get(paper.id) : undefined;

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
      };
    }),
  };
}
