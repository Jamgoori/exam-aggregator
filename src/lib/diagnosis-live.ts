import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// AI 약점 진단의 "결정적(무AI) 데이터층". 페이지 입장 즉시 그리는 과목별 개념 오답
// 분포(막대그래프)와, 진단받기(온디맨드 API) 때 AI에 넣을 집계 입력을 같은 함수 하나로
// 만든다. next-diagnosis.mjs(배치 스크립트)의 집계 로직을 서버 런타임으로 이식한 것 —
// question_explanations/paper_answers는 service_role만 읽으므로 admin 클라이언트로 돈다.
// 호출부는 반드시 본인(userId) 확인을 끝낸 뒤에만 부를 것.

type Admin = ReturnType<typeof createAdminClient>;

// 개념(keyword_title) 단위 오답 통계. corpusCount는 전체 기출에서 이 개념 문항이 몇 개
// 있는지(같은개념 5문제 풀기 가능 여부 + 출제 빈도 산정의 근거). 화면은 이 배열을 과목별로
// 묶어 막대그래프를 그린다.
export type ConceptStat = {
  concept: string;
  subject: string | null;
  subjectSlug: string | null;
  wrongCount: number;
  resolvedCount: number;
  // CBT 정답률(%). 응시 기록이 없으면 null.
  accuracyPct: number | null;
  // 전체 기출 코퍼스에서 같은 keyword_title 문항 수.
  corpusCount: number;
};

export type SubjectStat = {
  name: string;
  slug: string;
  attempts: number;
  avgScorePct: number | null;
  // 최근 최대 5회 정오율(오래된→최신). 추세용.
  recentScores: number[];
};

// 한 과목 안의 개념 오답 묶음(막대그래프 한 그룹).
export type SubjectConceptGroup = {
  subject: string;
  subjectSlug: string | null;
  // 이 과목에서 틀린 문항 총합(그래프 정렬·상단 요약용).
  totalWrong: number;
  concepts: ConceptStat[];
};

export type DiagnosisAggregate = {
  totals: { attempts: number; wrongQuestions: number; conceptsWithKeyword: number };
  subjects: SubjectStat[];
  // wrongCount 내림차순, 최대 30개.
  concepts: ConceptStat[];
  // 과목별로 묶은 개념 오답(막대그래프용). totalWrong 내림차순.
  bySubject: SubjectConceptGroup[];
};

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchAll<T>(
  admin: Admin,
  table: string,
  columns: string,
  // supabase 쿼리 빌더 체인은 타입이 복잡해 여기선 느슨하게 받는다(런타임 안전).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apply: (q: any) => any,
): Promise<T[]> {
  const rows: T[] = [];
  let from = 0;
  const SIZE = 1000;
  while (true) {
    const base = admin.from(table).select(columns).range(from, from + SIZE - 1);
    const q = apply(base);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...(data as T[]));
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return rows;
}

const questionKey = (pid: string, n: number) => `${pid}#${n}`;

// 사용자의 오답·응시 통계와 개념(keyword_title) 분포를 집계한다. 무AI. 배치 스크립트
// next-diagnosis.mjs와 같은 규칙을 쓰되, 화면·생성기 양쪽에서 쓰도록 corpusCount와
// 과목별 묶음(bySubject)까지 함께 돌려준다.
export async function getDiagnosisAggregate(userId: string): Promise<DiagnosisAggregate> {
  const admin = createAdminClient();

  // 1) 응시 이력(과목 포함) — 과목별 정오율·추세.
  const attempts = await fetchAll<{
    id: string;
    paper_id: string;
    score: number | null;
    total_questions: number | null;
    exam_papers: { subject_id: string; subjects: { name: string; slug: string } | null } | null;
  }>(
    admin,
    "cbt_attempts",
    "id, paper_id, score, total_questions, exam_papers!inner(subject_id, subjects(name, slug))",
    (q) => q.eq("user_id", userId).order("created_at", { ascending: true }),
  );

  const bySubjectMap = new Map<
    string,
    { name: string; slug: string; attempts: number; scoreSum: number; totalSum: number; recentPct: number[] }
  >();
  for (const a of attempts) {
    const subj = a.exam_papers?.subjects;
    if (!subj) continue;
    const entry =
      bySubjectMap.get(subj.slug) ??
      { name: subj.name, slug: subj.slug, attempts: 0, scoreSum: 0, totalSum: 0, recentPct: [] };
    entry.attempts++;
    entry.scoreSum += a.score ?? 0;
    entry.totalSum += a.total_questions ?? 0;
    if ((a.total_questions ?? 0) > 0) {
      entry.recentPct.push(Math.round(((a.score ?? 0) / (a.total_questions as number)) * 100));
    }
    bySubjectMap.set(subj.slug, entry);
  }
  const subjects: SubjectStat[] = [...bySubjectMap.values()].map((e) => ({
    name: e.name,
    slug: e.slug,
    attempts: e.attempts,
    avgScorePct: e.totalSum > 0 ? Math.round((e.scoreSum / e.totalSum) * 100) : null,
    recentScores: e.recentPct.slice(-5),
  }));

  // 1-1) CBT 제출별 정오 — 문항별 정답률(섞어풀기 제외, CBT 기준).
  const attemptPaper = new Map(attempts.map((a) => [a.id, a.paper_id]));
  const answerStats = new Map<string, { correct: number; total: number }>();
  const attemptIds = attempts.map((a) => a.id);
  for (const ids of chunk(attemptIds, 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{
      attempt_id: string;
      question_number: number;
      selected_choice: number | null;
      is_correct: boolean | null;
    }>(
      admin,
      "cbt_attempt_answers",
      "attempt_id, question_number, selected_choice, is_correct",
      (q) => q.in("attempt_id", ids),
    );
    for (const r of rows) {
      if (r.selected_choice == null) continue;
      const paperId = attemptPaper.get(r.attempt_id);
      if (!paperId) continue;
      const k = questionKey(paperId, r.question_number);
      const e = answerStats.get(k) ?? { correct: 0, total: 0 };
      e.total++;
      if (r.is_correct) e.correct++;
      answerStats.set(k, e);
    }
  }

  // 2) 한 번이라도 틀린 문항(통합 상태) — 개념 분포.
  const statusRows = await fetchAll<{
    paper_id: string;
    question_number: number;
    wrong_count: number;
    last_is_correct: boolean;
  }>(
    admin,
    "user_question_status",
    "paper_id, question_number, wrong_count, last_is_correct",
    (q) => q.eq("user_id", userId).gt("wrong_count", 0),
  );

  // 3) (paper, 문항) → questions.id → keyword_title, paper → subject.
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];
  const questionIdByKey = new Map<string, string>();
  const paperSubject = new Map<string, { name: string; slug: string } | null>();
  for (const ids of chunk(paperIds, 100)) {
    if (ids.length === 0) continue;
    const qrows = await fetchAll<{ id: string; paper_id: string; question_number: number }>(
      admin,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids),
    );
    for (const r of qrows) questionIdByKey.set(questionKey(r.paper_id, r.question_number), r.id);

    const prows = await fetchAll<{
      id: string;
      subject_id: string;
      subjects: { name: string; slug: string } | null;
    }>(
      admin,
      "exam_papers",
      "id, subject_id, subjects(name, slug)",
      (q) => q.in("id", ids),
    );
    for (const p of prows) {
      paperSubject.set(p.id, p.subjects ? { name: p.subjects.name, slug: p.subjects.slug } : null);
    }
  }

  // keyword_title 조회.
  const questionIds = [...questionIdByKey.values()];
  const keywordByQuestionId = new Map<string, string>();
  for (const ids of chunk(questionIds, 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{ question_id: string; keyword_title: string | null }>(
      admin,
      "question_explanations",
      "question_id, keyword_title",
      (q) => q.in("question_id", ids),
    );
    for (const r of rows) {
      if (r.keyword_title && r.keyword_title.trim()) {
        keywordByQuestionId.set(r.question_id, r.keyword_title.trim());
      }
    }
  }

  // 4) 개념 × 과목 집계.
  const conceptMap = new Map<
    string,
    {
      concept: string;
      subject: string | null;
      subjectSlug: string | null;
      wrongCount: number;
      resolvedCount: number;
      correctSum: number;
      answerSum: number;
    }
  >();
  for (const r of statusRows) {
    const qid = questionIdByKey.get(questionKey(r.paper_id, r.question_number));
    if (!qid) continue;
    const concept = keywordByQuestionId.get(qid);
    if (!concept) continue;
    const subj = paperSubject.get(r.paper_id);
    const key = `${concept}###${subj?.slug ?? ""}`;
    const entry =
      conceptMap.get(key) ??
      {
        concept,
        subject: subj?.name ?? null,
        subjectSlug: subj?.slug ?? null,
        wrongCount: 0,
        resolvedCount: 0,
        correctSum: 0,
        answerSum: 0,
      };
    entry.wrongCount++;
    if (r.last_is_correct) entry.resolvedCount++;
    const st = answerStats.get(questionKey(r.paper_id, r.question_number));
    if (st) {
      entry.correctSum += st.correct;
      entry.answerSum += st.total;
    }
    conceptMap.set(key, entry);
  }

  const conceptsRaw = [...conceptMap.values()]
    .map((e) => ({
      concept: e.concept,
      subject: e.subject,
      subjectSlug: e.subjectSlug,
      wrongCount: e.wrongCount,
      resolvedCount: e.resolvedCount,
      accuracyPct: e.answerSum > 0 ? Math.round((e.correctSum / e.answerSum) * 100) : null,
    }))
    .sort((a, b) => b.wrongCount - a.wrongCount || a.resolvedCount - b.resolvedCount)
    .slice(0, 30);

  // 5) 각 개념의 전체 기출 corpus 문항 수. 같은개념 5문제 풀기 가능 여부 판단에 그대로 쓰고,
  // 화면 뱃지(출제 빈도)에도 활용한다. keyword_title 1:1 문항이라 해설 개수가 곧 문항 수.
  const uniqueConcepts = [...new Set(conceptsRaw.map((c) => c.concept))];
  const corpusCount = new Map<string, number>();
  // 개념 수가 최대 30개라 순차면 왕복이 쌓인다 — 병렬로 센다.
  await Promise.all(
    uniqueConcepts.map(async (kw) => {
      const { count } = await admin
        .from("question_explanations")
        .select("question_id", { count: "exact", head: true })
        .eq("keyword_title", kw);
      corpusCount.set(kw, count ?? 0);
    }),
  );

  const concepts: ConceptStat[] = conceptsRaw.map((c) => ({
    ...c,
    corpusCount: corpusCount.get(c.concept) ?? 0,
  }));

  // 6) 과목별 묶음(막대그래프). 과목명 없는 개념은 "기타"로 접지 않고 subject=null 그룹.
  const groupMap = new Map<string, SubjectConceptGroup>();
  for (const c of concepts) {
    const key = c.subjectSlug ?? "__none__";
    const g =
      groupMap.get(key) ??
      { subject: c.subject ?? "기타", subjectSlug: c.subjectSlug, totalWrong: 0, concepts: [] };
    g.totalWrong += c.wrongCount;
    g.concepts.push(c);
    groupMap.set(key, g);
  }
  const bySubject = [...groupMap.values()]
    .map((g) => ({ ...g, concepts: g.concepts.sort((a, b) => b.wrongCount - a.wrongCount) }))
    .sort((a, b) => b.totalWrong - a.totalWrong);

  return {
    totals: {
      attempts: attempts.length,
      wrongQuestions: statusRows.length,
      conceptsWithKeyword: conceptMap.size,
    },
    subjects,
    concepts,
    bySubject,
  };
}
