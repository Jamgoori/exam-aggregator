import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ExamType, Subject } from "@/lib/supabase/types";
import type { QuestionExplanationContent } from "@/components/wrong-note-question-card";
import {
  collidingPaperIds,
  fetchPaperIdentitySignals,
  representativePaperIds,
} from "@/lib/dedup-papers";
import { stripTrackFromTitle } from "@/lib/paper-title";

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
  // 있으면 buildWrongNoteGroups가 문제지별 "최근 점수"까지 채운다
  // (과목 오답노트의 문제지 카드처럼 점수를 함께 보여주는 화면용).
  score?: number;
  total_questions?: number;
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
  // 응시 행에 score/total_questions가 없으면 null (마이페이지 탭은 안 쓴다).
  latestScore: number | null;
  latestTotal: number | null;
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

// 오답노트 문항 마크. deleted는 오답노트에서 완전히 제외한 문항(실수/지엽 문항),
// pinned는 "다시 볼 문제" 체크. 키는 `${paper_id}#${question_number}`.
// 응시 원본은 건드리지 않고 조회·집계·섞어풀기 후보에서만 걸러내는 방식이라,
// 테이블이 아직 없는 환경에서도(마이그레이션 전) 빈 마크로 안전하게 동작한다.
export type WrongNoteMarks = { deleted: Set<string>; pinned: Set<string> };

export const EMPTY_MARKS: WrongNoteMarks = { deleted: new Set(), pinned: new Set() };

export async function fetchWrongNoteMarks(
  supabase: Supabase,
  userId: string,
  paperIds?: string[],
): Promise<WrongNoteMarks> {
  const deleted = new Set<string>();
  const pinned = new Set<string>();
  if (paperIds && paperIds.length === 0) return { deleted, pinned };

  const idChunks = paperIds ? chunk(paperIds, 200) : [null];
  for (const ids of idChunks) {
    let query = supabase
      .from("wrong_note_marks")
      .select("paper_id, question_number, pinned, deleted")
      .eq("user_id", userId);
    if (ids) query = query.in("paper_id", ids);
    const { data, error } = await query;
    if (error) return { deleted: new Set(), pinned: new Set() };
    for (const r of data ?? []) {
      const key = `${r.paper_id}#${r.question_number}`;
      if (r.deleted) deleted.add(key);
      if (r.pinned) pinned.add(key);
    }
  }
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
  // 완전 삭제된 문항(`${paperId}#${qnum}`)은 집계에서 뺀다.
  deletedKeys?: Set<string>,
): WrongNoteSubjectGroup[] {
  const paperByAttempt = new Map<string, string>();
  for (const a of attempts) {
    if (a.exam_papers) paperByAttempt.set(a.id, a.exam_papers.id);
  }
  const wrongByAttempt = new Map<string, WrongAnswerRow[]>();
  for (const row of wrongRows) {
    if (deletedKeys?.size) {
      const paperId = paperByAttempt.get(row.attempt_id);
      if (paperId && deletedKeys.has(`${paperId}#${row.question_number}`)) continue;
    }
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
      latestScore: latest.score ?? null,
      latestTotal: latest.total_questions ?? null,
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
  "id, created_at, score, total_questions, exam_papers(id, title, level, choice_count, subjects(*), exam_types(*))";

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

  const [wrongRows, marks] = await Promise.all([
    fetchWrongAnswerRows(
      supabase,
      attempts.map((a) => a.id),
    ),
    fetchWrongNoteMarks(supabase, userId),
  ]);
  return buildWrongNoteGroups(attempts, wrongRows, marks.deleted);
}

// 화면에 그릴 수 있게 이미지/정답/해설까지 붙인 문제 상세.
export type WrongNoteQuestionDetail = WrongNoteQuestionSummary & {
  correctChoice: number | null;
  choiceCount: number;
  images: string[];
  explanation: QuestionExplanationContent | null;
  // "다시 볼 문제" 체크 여부.
  pinned: boolean;
};

export type QuestionMediaEntry = { choiceCount: number | null; images: string[] };

// 문제지들의 문항별 크롭 이미지(공개 URL)와 선지 수를 한 번에 받아온다.
// questions/question_images는 public read라 사용자 세션 클라이언트로 충분하다.
export async function fetchQuestionMedia(
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

// 선지 번호가 "①"/"1번"/객체/배열 등 어떤 형태로 저장돼 있어도 숫자로 되살린다.
function parseChoiceNumber(raw: unknown, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const circled = "①②③④⑤⑥⑦⑧".indexOf(raw.trim().charAt(0));
    if (circled >= 0) return circled + 1;
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// choice_explanations는 해설 제작 루틴이 jsonb로 저장한다. 배열([문자열] 또는
// [{choice, explanation}]) / 객체({"1": "..."} 또는 {"①": "..."}) 어느 형태로
// 들어와도 화면용 목록으로 정규화한다. 법령 문항 선지는 항목에 current_status
// ("유효"/"개정됨"/"확인불가")와 original_note(개정됨일 때 "출제 당시엔 어땠나"
// 한 줄)가 더 붙는데, 있을 때만 실어 보낸다(없으면 null — 화면이 있는 것만 그린다).
// 해설 본문(explanation)은 현행법 기준으로 생성된다 — 프롬프트 참조.
type NormalizedChoice = {
  choice: number;
  text: string;
  currentStatus: string | null;
  originalNote: string | null;
};

function normalizeChoiceExplanations(raw: unknown): NormalizedChoice[] {
  if (!raw) return [];

  const textOf = (v: unknown): string => {
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const t = o.explanation ?? o.text ?? o.content ?? o.reason;
      if (typeof t === "string") return t;
    }
    return "";
  };
  const strOrNull = (v: unknown): string | null =>
    typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

  let entries: NormalizedChoice[] = [];
  if (Array.isArray(raw)) {
    entries = raw.map((item, i) => {
      const o = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
      return {
        choice: parseChoiceNumber(o.choice ?? o.number ?? o.choice_number, i + 1),
        text: textOf(item),
        currentStatus: strOrNull(o.current_status),
        originalNote: strOrNull(o.original_note),
      };
    });
  } else if (typeof raw === "object") {
    entries = Object.entries(raw as Record<string, unknown>).map(([key, v], i) => ({
      choice: parseChoiceNumber(key, i + 1),
      text: textOf(v),
      currentStatus: null,
      originalNote: null,
    }));
  }

  return entries
    .filter((e) => e.text.trim().length > 0)
    .sort((a, b) => a.choice - b.choice);
}

type ExplanationRow = {
  keyword_title: string | null;
  keyword_explanation: string | null;
  choice_explanations: unknown;
  correct_choice_summary: string | null;
  law_amendment_note: string | null;
  current_answer_status: string | null;
  current_answer_note: string | null;
  law_basis_date: string | null;
};

function toExplanationContent(row: ExplanationRow): QuestionExplanationContent | null {
  const content: QuestionExplanationContent = {
    keywordTitle: row.keyword_title?.trim() || null,
    keywordExplanation: row.keyword_explanation?.trim() || null,
    choiceExplanations: normalizeChoiceExplanations(row.choice_explanations),
    correctChoiceSummary: row.correct_choice_summary?.trim() || null,
    lawAmendmentNote: row.law_amendment_note?.trim() || null,
    currentAnswerStatus: row.current_answer_status?.trim() || null,
    currentAnswerNote: row.current_answer_note?.trim() || null,
    lawBasisDate: row.law_basis_date?.trim() || null,
  };
  const empty =
    !content.keywordTitle &&
    !content.keywordExplanation &&
    content.choiceExplanations.length === 0 &&
    !content.correctChoiceSummary &&
    !content.lawAmendmentNote &&
    !content.currentAnswerNote;
  return empty ? null : content;
}

// 문항 해설. question_explanations는 해설 제작 루틴이 관리하는 테이블로
// questions.id(question_id)를 키로 쓰므로, questions를 거쳐 (paper_id,
// question_number)로 환원한다. 해설에는 정답이 담기므로 일반 select는 막아두고
// (관리자 전용 RLS 권장) service role로만 읽는다. 해설이 없는 문항은 그냥 빠진다.
async function fetchExplanations(
  paperIds: string[],
): Promise<Map<string, Map<number, QuestionExplanationContent>>> {
  const admin = createAdminClient();
  const byPaper = new Map<string, Map<number, QuestionExplanationContent>>();
  for (const ids of chunk(paperIds, 10)) {
    let from = 0;
    while (true) {
      // created_at 오름차순이라, 같은 문항에 해설이 여러 번 생성됐으면
      // 아래 map.set이 가장 최근 것으로 자연스럽게 덮어쓴다.
      const { data } = await admin
        .from("question_explanations")
        .select(
          "id, created_at, keyword_title, keyword_explanation, choice_explanations, correct_choice_summary, law_amendment_note, current_answer_status, current_answer_note, law_basis_date, questions!inner(paper_id, question_number)",
        )
        .in("questions.paper_id", ids)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + BATCH_SIZE - 1);
      if (!data || data.length === 0) break;
      for (const row of data) {
        const q = row.questions as unknown as {
          paper_id: string;
          question_number: number;
        } | null;
        if (!q) continue;
        const content = toExplanationContent(row as unknown as ExplanationRow);
        if (!content) continue;
        const paperMap =
          byPaper.get(q.paper_id) ?? new Map<number, QuestionExplanationContent>();
        paperMap.set(q.question_number, content);
        byPaper.set(q.paper_id, paperMap);
      }
      if (data.length < BATCH_SIZE) break;
      from += BATCH_SIZE;
    }
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
): WrongNoteQuestionDetail {
  const entry = media?.get(q.questionNumber);
  return {
    ...q,
    correctChoice: answers?.[q.questionNumber - 1] ?? null,
    choiceCount: entry?.choiceCount ?? paper.choice_count,
    images: entry?.images ?? [],
    explanation: explanations?.get(q.questionNumber) ?? null,
    pinned: pinnedKeys?.has(`${paper.id}#${q.questionNumber}`) ?? false,
  };
}

// 과목 오답노트 페이지용: 오답이 있는 문제지 목록을 요약(회독 수·최근 점수·오답/극복
// 수)만으로 돌려준다. 문항 이미지·해설은 문제지 오답노트 페이지에서 그 문제지 것만
// 받는다 — 회독이 쌓여도 과목 페이지가 무거워지지 않게 하려는 분리다.
// 과목 slug가 존재하지 않으면 null.
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
  // 사용자가 이 문항에 남긴 개인 메모(없으면 null).
  memo: string | null;
  // 전국 오답률(%). 표본이 충분한 문항만 채워지고, 적으면 null(배지 숨김).
  wrongRatePct: number | null;
  // "다시 볼 문제" 체크 여부.
  pinned: boolean;
};

// 전국 오답률 배지를 띄우기 위한 최소 표본(이보다 적으면 오해를 주므로 숨긴다).
export const WRONGRATE_MIN_SAMPLE = 10;

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
  for (const ids of chunk(realPaperIds, 200)) {
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
  }
  return out;
}

// 문항 메모(본인 것만, RLS). `${paperId}#${qnum}` → 메모.
async function fetchMemos(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 200)) {
    const { data } = await supabase
      .from("question_memos")
      .select("paper_id, question_number, memo")
      .eq("user_id", userId)
      .in("paper_id", ids);
    for (const r of data ?? []) {
      const memo = (r.memo as string | null)?.trim();
      if (memo) out.set(`${r.paper_id}#${r.question_number}`, memo);
    }
  }
  return out;
}

// 전국 오답률(%). paper_question_wrong_rates(security definer)로 전체 응시를 집계.
// 표본이 WRONGRATE_MIN_SAMPLE 미만이면 넣지 않는다(작은 표본은 오해를 준다).
async function fetchWrongRates(
  supabase: Supabase,
  paperIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (paperIds.length === 0) return out;
  for (const ids of chunk(paperIds, 100)) {
    const { data, error } = await supabase.rpc("paper_question_wrong_rates", {
      p_paper_ids: ids,
    });
    if (error) continue; // 함수 미적용 환경: 배지 없이 넘어간다.
    for (const r of (data ?? []) as { paper_id: string; question_number: number; attempts: number; wrongs: number }[]) {
      if (r.attempts < WRONGRATE_MIN_SAMPLE) continue;
      out.set(`${r.paper_id}#${r.question_number}`, Math.round((r.wrongs / r.attempts) * 100));
    }
  }
  return out;
}

export async function getSubjectWrongNoteQuestions(
  supabase: Supabase,
  userId: string,
  slug: string,
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
  if (attempts.length === 0) {
    return { subject, questions: [], unresolvedCount: 0, resolvedCount: 0 };
  }

  // 응시에 등장한 문제지들(중복 제거) — dedup 대표 계산 입력.
  const distinctPapers = new Map<string, SubjectAttemptPaper>();
  for (const a of attempts) {
    const p = a.exam_papers!;
    if (!distinctPapers.has(p.id)) distinctPapers.set(p.id, p);
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
      title: collapsed && p.track ? stripTrackFromTitle(p.title, p.track) : p.title,
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

  const repIds = [...repInfo.keys()];
  const [mediaByPaper, answersByPaper, explanationsByPaper, statusByRepQ, memoByRepQ, rateByRepQ, rawMarks] =
    await Promise.all([
      fetchQuestionMedia(supabase, repIds),
      fetchCorrectAnswers(repIds),
      fetchExplanations(repIds),
      fetchQuestionStatusByRep(supabase, userId, paperList.map((p) => p.id), repId),
      fetchMemos(supabase, userId, repIds),
      fetchWrongRates(supabase, repIds),
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
  for (const ids of chunk(paperIds, 100)) {
    const { data } = await supabase
      .from("exam_papers")
      .select("id, subject_id, exam_type_id, year, round, level, title, subjects(id, name, slug)")
      .in("id", ids);
    for (const p of (data ?? []) as unknown as PaperMeta[]) papers.push(p);
  }
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
export async function getPaperWrongNote(
  supabase: Supabase,
  userId: string,
  paperId: string,
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

  const [wrongRows, marks] = await Promise.all([
    fetchWrongAnswerRows(
      supabase,
      attempts.map((a) => a.id),
    ),
    fetchWrongNoteMarks(supabase, userId, [paperId]),
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
  const group = buildWrongNoteGroups(attempts, wrongRows, marks.deleted)[0]?.papers[0];
  if (!group) {
    return { paper, rounds, questions: [], unresolvedCount: 0, resolvedCount: 0 };
  }

  const [mediaByPaper, answersByPaper, explanationsByPaper] = await Promise.all([
    fetchQuestionMedia(supabase, [paper.id]),
    fetchCorrectAnswers([paper.id]),
    fetchExplanations([paper.id]),
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
  // 같은 문항에 해설이 여러 번 생성됐을 수 있으므로 행 수가 아니라
  // "해설이 있는 문항 번호"의 개수를 센다.
  const { data } = await admin
    .from("question_explanations")
    .select("questions!inner(paper_id, question_number)")
    .eq("questions.paper_id", paperId);
  const numbers = new Set(
    (data ?? [])
      .map((row) => (row.questions as unknown as { question_number: number } | null)?.question_number)
      .filter((n): n is number => n != null),
  );
  return numbers.size;
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
    fetchExplanations([paper.id]),
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

  // 문제지가 삭제됐으면 이미지·정답·해설 없이 번호/선택지만 보여준다.
  const paper = attempt.exam_papers;
  const [mediaByPaper, answersByPaper, explanationsByPaper] =
    paper && wrong.length > 0
      ? await Promise.all([
          fetchQuestionMedia(supabase, [paper.id]),
          fetchCorrectAnswers([paper.id]),
          fetchExplanations([paper.id]),
        ])
      : [
          new Map<string, Map<number, QuestionMediaEntry>>(),
          new Map<string, number[]>(),
          new Map<string, Map<number, QuestionExplanationContent>>(),
        ];

  const media = paper ? mediaByPaper.get(paper.id) : undefined;
  const answers = paper ? answersByPaper.get(paper.id) : undefined;
  const explanations = paper ? explanationsByPaper.get(paper.id) : undefined;

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
      };
    }),
  };
}
