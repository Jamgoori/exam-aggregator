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
  // 정본 개념 id(있으면). 같은개념 기출 뽑기·코퍼스 집계는 이 축을 쓴다. 아직 정본이
  // 안 붙은 문항은 null이고, 그때만 keyword_title 표기로 떨어진다.
  conceptId: string | null;
  // 지식형/기능형. 진단 문구가 갈린다("개념을 모른다" vs "이 유형에 약하다").
  conceptKind: string | null;
  subject: string | null;
  subjectSlug: string | null;
  // 이 창(기간) 안에서 틀린 문항 수(문항 단위 중복 제거).
  wrongCount: number;
  // 이 창 안에서 이 개념 문항을 푼 총 횟수와 그중 정답률(%). 표본이 없으면 null.
  answeredCount: number;
  accuracyPct: number | null;
  // 전체 기출 코퍼스에서 같은 keyword_title 문항 수.
  corpusCount: number;
  // 이 개념을 전부 맞혔다면 그 과목 회차 점수가 몇 점 오르는지(%p). 계산은
  // 이 개념 오답 수 ÷ 그 과목에서 이 기간에 푼 문항 수 × 100 — AI가 아니라 산수다.
  // "몇 문항 틀렸다"만으로는 심각도가 안 잡혀서, 사용자가 아는 단위(점수)로 바꿔 준다.
  // 그 개념을 **전부** 맞힌다는 가정의 상한이므로 화면에서 단독으로 크게 쓰지 말 것
  // (회차당 몇 문항인지와 함께 보여준다).
  scoreGainPct: number | null;
};

export type SubjectStat = {
  // subjects.id. 진단 과목 선택(review_preferences.diagnosis_paused_subject_ids)이
  // id 축이라 화면이 토글하려면 이 값이 필요하다.
  id: string;
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

// 집계 기간. days=null 이면 전체 기간.
export type DiagnosisWindow = {
  days: number | null;
  // 요청한 기간에 푼 문제가 없어 자동으로 넓힌 경우 true(화면이 그 사실을 알린다).
  widened: boolean;
};

export type DiagnosisAggregate = {
  window: DiagnosisWindow;
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

// days 전부터 지금까지의 ISO 시각. days=null 이면 제한 없음(전체 기간).
function sinceIso(days: number | null): string | null {
  if (days == null) return null;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

// 기간 안에 사용자가 푼 문항별 정오 집계. CBT 제출과 섞어풀기·복습 세션을 모두 센다
// (사용자에겐 둘 다 "푼 것"이고, 한쪽만 세면 복습으로만 공부한 주가 빈칸이 된다).
// 같은 문항을 여러 번 풀었으면 total 이 늘고, 그중 틀린 횟수가 wrong 이다.
async function collectAnswerEvents(
  admin: Admin,
  userId: string,
  days: number | null,
): Promise<Map<string, { paperId: string; questionNumber: number; wrong: number; total: number }>> {
  const since = sinceIso(days);
  const out = new Map<string, { paperId: string; questionNumber: number; wrong: number; total: number }>();

  const bump = (paperId: string, questionNumber: number, isCorrect: boolean | null) => {
    const k = questionKey(paperId, questionNumber);
    const e = out.get(k) ?? { paperId, questionNumber, wrong: 0, total: 0 };
    e.total++;
    if (isCorrect === false) e.wrong++;
    out.set(k, e);
  };

  // CBT: 제출(attempt) → 문항별 응답.
  const attemptRows = await fetchAll<{ id: string; paper_id: string }>(
    admin,
    "cbt_attempts",
    "id, paper_id",
    (q) => (since ? q.eq("user_id", userId).gte("created_at", since) : q.eq("user_id", userId)),
  );
  const attemptPaperId = new Map(attemptRows.map((a) => [a.id, a.paper_id]));
  for (const ids of chunk([...attemptPaperId.keys()], 100)) {
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
      // 안 푼(미선택) 문항은 "틀렸다"가 아니라 "안 풀었다"이므로 세지 않는다.
      if (r.selected_choice == null) continue;
      const paperId = attemptPaperId.get(r.attempt_id);
      if (paperId) bump(paperId, r.question_number, r.is_correct);
    }
  }

  // 섞어풀기·복습: 채점을 마친(submitted) 세션만.
  const sessionRows = await fetchAll<{ id: string }>(
    admin,
    "review_sessions",
    "id",
    (q) => {
      const base = q.eq("user_id", userId).not("submitted_at", "is", null);
      return since ? base.gte("created_at", since) : base;
    },
  );
  for (const ids of chunk(sessionRows.map((s) => s.id), 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{
      paper_id: string;
      question_number: number;
      selected_choice: number | null;
      is_correct: boolean | null;
    }>(
      admin,
      "review_session_items",
      "paper_id, question_number, selected_choice, is_correct",
      (q) => q.in("session_id", ids),
    );
    for (const r of rows) {
      if (r.selected_choice == null) continue;
      bump(r.paper_id, r.question_number, r.is_correct);
    }
  }

  return out;
}

// 자동 확장 사다리. 요청한 기간에 푼 문제가 없으면 다음 칸으로 넓힌다 — 며칠 쉰
// 사용자에게 빈 그래프를 보여주는 것보다 "언제 것"인지 밝히고 보여주는 편이 낫다.
const WIDEN_LADDER: (number | null)[] = [7, 30, 90, null];

// 사용자가 이 기간에 "무엇을 틀렸는지"를 개념별로 집계한다(무AI).
//
// 누적 상태(user_question_status)가 아니라 **응시 이벤트**를 읽는다. 목표가 "지난
// 일주일 동안 어떤 개념 위주로 틀렸나"라서 시점이 필요한데, 누적 상태에는 마지막
// 응답 시각 하나뿐이라 기간을 자를 수 없다. CBT 제출(cbt_attempt_answers)과
// 섞어풀기·복습(review_session_items)을 모두 센다 — 사용자에겐 둘 다 "푼 것"이다.
export async function getDiagnosisAggregate(
  userId: string,
  // subjectSlug 를 주면 그 과목만 집계한다(화면의 과목 칩). 개념 상위 30개를 자르기
  // **전에** 걸러야 한다 — 전체에서 자른 뒤 거르면 개념이 잘게 쪼개진 과목이 통째로
  // 사라진다.
  opts: { days?: number | null; widen?: boolean; subjectSlug?: string | null } = {},
): Promise<DiagnosisAggregate> {
  const admin = createAdminClient();
  const requested = opts.days === undefined ? 7 : opts.days;
  // widen=false 면 창을 절대 넓히지 않는다. AI 분석 경로가 이걸 쓴다 — 창이 곧 프롬프트
  // 크기이자 요금이라, 빈 주에 조용히 90일치를 긁어 오면 안 된다.
  const widenAllowed = opts.widen !== false;
  const subjectFilter = opts.subjectSlug ?? null;

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
    {
      id: string;
      name: string;
      slug: string;
      attempts: number;
      scoreSum: number;
      totalSum: number;
      recentPct: number[];
    }
  >();
  for (const a of attempts) {
    const subj = a.exam_papers?.subjects;
    if (!subj) continue;
    const entry =
      bySubjectMap.get(subj.slug) ??
      {
        id: a.exam_papers?.subject_id ?? "",
        name: subj.name,
        slug: subj.slug,
        attempts: 0,
        scoreSum: 0,
        totalSum: 0,
        recentPct: [],
      };
    entry.attempts++;
    entry.scoreSum += a.score ?? 0;
    entry.totalSum += a.total_questions ?? 0;
    if ((a.total_questions ?? 0) > 0) {
      entry.recentPct.push(Math.round(((a.score ?? 0) / (a.total_questions as number)) * 100));
    }
    bySubjectMap.set(subj.slug, entry);
  }
  const subjects: SubjectStat[] = [...bySubjectMap.values()].map((e) => ({
    id: e.id,
    name: e.name,
    slug: e.slug,
    attempts: e.attempts,
    avgScorePct: e.totalSum > 0 ? Math.round((e.scoreSum / e.totalSum) * 100) : null,
    recentScores: e.recentPct.slice(-5),
  }));

  // 2) 기간 안의 응시 이벤트 → 문항별 정오. CBT와 섞어풀기를 합쳐 센다.
  //    사다리를 따라 넓히며 "틀린 문항이 하나라도 나오는" 첫 창을 쓴다.
  // 요청한 창부터 시작해, 그보다 넓은 칸만 사다리로 이어 붙인다(요청이 9일이면
  // 9 → 30 → 90 → 전체). 화면에서만 넓히고, 분석 경로는 widen:false 로 첫 칸에 묶인다.
  const ladder: (number | null)[] = !widenAllowed
    ? [requested]
    : [requested, ...WIDEN_LADDER.filter((d) => d === null || (requested !== null && d > requested))];

  type QuestionStat = { paperId: string; questionNumber: number; wrong: number; total: number };
  let statsByQuestion = new Map<string, QuestionStat>();
  let usedDays: number | null = requested;
  let widened = false;

  for (const days of ladder) {
    statsByQuestion = await collectAnswerEvents(admin, userId, days);
    const anyWrong = [...statsByQuestion.values()].some((s) => s.wrong > 0);
    if (anyWrong) {
      usedDays = days;
      widened = days !== requested;
      break;
    }
    usedDays = days;
    widened = days !== requested;
  }

  // 막대그래프에 세는 "틀린 문항"은 이 기간에 한 번이라도 틀린 것만이다.
  const statusRows = [...statsByQuestion.values()]
    .filter((s) => s.wrong > 0)
    .map((s) => ({ paper_id: s.paperId, question_number: s.questionNumber }));
  // 정답률은 그 개념 문항을 **푼 것 전체**로 낸다. 예전엔 위의 오답 문항만 순회해서
  // 분모와 분자가 같은 집합이었고, 한 문항을 한 번씩만 푼 사용자(대부분)는 모든 개념이
  // 정답률 0%로 표시됐다 — 66문항 중 13개 틀린 개념도 0%였다. 맞힌 문항이 분모에
  // 들어가야 "이 개념 몇 문항 중 몇 개 틀렸나"가 되고, 그래야 오답 수가 같은 두 개념
  // 중 무엇이 더 급한지 판단할 수 있다.
  const answeredRows = [...statsByQuestion.values()];
  const answerStats = statsByQuestion;

  // 3) (paper, 문항) → questions.id → keyword_title, paper → subject.
  const paperIds = [...new Set(answeredRows.map((r) => r.paperId))];
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

  // 개념 조회. 진단 축은 정본 개념(concept_id)이다 — keyword_title은 해설 배치가
  // 문항마다 자유롭게 쓴 문자열이라 사실상 문항 1:1이고(코퍼스 기준 개념당 1.02문항),
  // 그 축으로 집계하면 막대가 전부 높이 1이 되어 "어디가 약한지"가 보이지 않는다.
  // 정본이 아직 안 붙은 문항만 keyword_title 표기로 남긴다(문서 규칙: 미매칭을 "기타"로
  // 뭉치지 말 것).
  const questionIds = [...questionIdByKey.values()];
  const conceptRefByQuestionId = new Map<string, { conceptId: string | null; title: string }>();
  const conceptIdsSeen = new Set<string>();
  for (const ids of chunk(questionIds, 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{
      question_id: string;
      keyword_title: string | null;
      concept_id: string | null;
    }>(
      admin,
      "question_explanations",
      "question_id, keyword_title, concept_id",
      (q) => q.in("question_id", ids),
    );
    for (const r of rows) {
      const title = (r.keyword_title ?? "").trim();
      if (!r.concept_id && !title) continue;
      if (r.concept_id) conceptIdsSeen.add(r.concept_id);
      conceptRefByQuestionId.set(r.question_id, { conceptId: r.concept_id, title });
    }
  }

  // 정본 개념의 이름·유형. 합쳐진 개념(merged_into)은 합쳐진 쪽 이름으로 보여준다.
  const conceptMeta = new Map<string, { name: string; kind: string | null }>();
  for (const ids of chunk([...conceptIdsSeen], 100)) {
    if (ids.length === 0) continue;
    const rows = await fetchAll<{ id: string; name: string; kind: string | null }>(
      admin,
      "concepts",
      "id, name, kind",
      (q) => q.in("id", ids),
    );
    for (const r of rows) conceptMeta.set(r.id, { name: r.name, kind: r.kind });
  }

  // 4) 개념 × 과목 집계.
  const conceptMap = new Map<
    string,
    {
      concept: string;
      conceptId: string | null;
      conceptKind: string | null;
      subject: string | null;
      subjectSlug: string | null;
      wrongCount: number;
      correctSum: number;
      answerSum: number;
    }
  >();
  // 예상 점수의 분모: 이 기간에 그 과목에서 푼 문항 수(개념이 안 붙은 문항도 포함해야
  // 실제 회차 점수 환산이 된다). 과목 필터와 무관하게 원래 과목 기준으로 센다.
  const answeredBySubject = new Map<string, number>();
  for (const r of answeredRows) {
    const slug = paperSubject.get(r.paperId)?.slug;
    if (slug) answeredBySubject.set(slug, (answeredBySubject.get(slug) ?? 0) + 1);
  }

  for (const r of answeredRows) {
    const qid = questionIdByKey.get(questionKey(r.paperId, r.questionNumber));
    if (!qid) continue;
    const ref = conceptRefByQuestionId.get(qid);
    if (!ref) continue;
    const meta = ref.conceptId ? conceptMeta.get(ref.conceptId) : undefined;
    // 정본이 있으면 정본 이름으로, 없으면 해설이 쓴 표기 그대로.
    const concept = meta?.name ?? ref.title;
    if (!concept) continue;
    const subj = paperSubject.get(r.paperId);
    if (subjectFilter && subj?.slug !== subjectFilter) continue;
    const key = `${ref.conceptId ?? `kw:${ref.title}`}###${subj?.slug ?? ""}`;
    const entry =
      conceptMap.get(key) ??
      {
        concept,
        conceptId: ref.conceptId,
        conceptKind: meta?.kind ?? null,
        subject: subj?.name ?? null,
        subjectSlug: subj?.slug ?? null,
        wrongCount: 0,
        correctSum: 0,
        answerSum: 0,
      };
    // 이 기간에 틀린 문항 1개 = 1. 같은 문항을 두 번 틀려도 문항 수로는 1이다
    // ("이 개념 문제 5개를 틀렸다"가 사람이 읽기 쉬운 단위). 맞히기만 한 문항은
    // 여기서 세지 않고 아래 정답률 분모에만 들어간다.
    if (r.wrong > 0) entry.wrongCount++;
    const st = answerStats.get(questionKey(r.paperId, r.questionNumber));
    if (st) {
      entry.correctSum += st.total - st.wrong;
      entry.answerSum += st.total;
    }
    conceptMap.set(key, entry);
  }

  const conceptsRaw = [...conceptMap.values()]
    // 이 기간에 한 번도 안 틀린 개념은 그래프에 세우지 않는다 — 분모 역할만 한 것이다.
    .filter((e) => e.wrongCount > 0)
    .map((e) => ({
      concept: e.concept,
      conceptId: e.conceptId,
      conceptKind: e.conceptKind,
      subject: e.subject,
      subjectSlug: e.subjectSlug,
      wrongCount: e.wrongCount,
      answeredCount: e.answerSum,
      accuracyPct: e.answerSum > 0 ? Math.round((e.correctSum / e.answerSum) * 100) : null,
      scoreGainPct: (() => {
        const denom = e.subjectSlug ? (answeredBySubject.get(e.subjectSlug) ?? 0) : 0;
        if (denom <= 0) return null;
        return Math.round((e.wrongCount / denom) * 1000) / 10;
      })(),
    }))
    .sort((a, b) => b.wrongCount - a.wrongCount || a.concept.localeCompare(b.concept))
    // 전체 상위 N개. 코칭 대상을 과목당 7개까지 고르므로(diagnosis-generate.ts) 이 컷이
    // 30이면 문항을 많이 푼 과목이 30자리를 다 가져가 다른 과목의 7번째가 사라진다.
    // 화면은 어차피 과목당 6개만 그리고(BARS_PER_SUBJECT) 이 배열은 AI 프롬프트에
    // 들어가지 않으므로, 과목 수 × 7을 넉넉히 덮는 값으로 둔다.
    .slice(0, 60);

  // 5) 각 개념의 전체 기출 corpus 문항 수. 같은개념 5문제 풀기 가능 여부 판단에 그대로 쓰고,
  // 화면 뱃지(출제 빈도)에도 쓴다. 정본 개념은 concept_id로 센다(평균 15문항). 정본이
  // 없는 것만 keyword_title로 세는데, 그 축은 문항 1:1이라 거의 항상 1이 나온다 —
  // 그래서 "기출이 적어 풀기를 만들 수 없어요"가 뜨면 개념이 아직 미분류라는 뜻이다.
  const corpusCount = new Map<string, number>();
  const countKeyOf = (c: { conceptId: string | null; concept: string }) =>
    c.conceptId ?? `kw:${c.concept}`;
  const uniqueTargets = new Map<string, { conceptId: string | null; concept: string }>();
  for (const c of conceptsRaw) uniqueTargets.set(countKeyOf(c), c);
  // 개념 수가 최대 30개라 순차면 왕복이 쌓인다 — 병렬로 센다.
  await Promise.all(
    [...uniqueTargets.entries()].map(async ([k, c]) => {
      const q = admin.from("question_explanations").select("question_id", { count: "exact", head: true });
      const { count } = await (c.conceptId
        ? q.eq("concept_id", c.conceptId)
        : q.eq("keyword_title", c.concept));
      corpusCount.set(k, count ?? 0);
    }),
  );

  const concepts: ConceptStat[] = conceptsRaw.map((c) => ({
    ...c,
    corpusCount: corpusCount.get(countKeyOf(c)) ?? 0,
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
    window: { days: usedDays, widened },
    totals: {
      attempts: attempts.length,
      wrongQuestions: subjectFilter
        ? statusRows.filter((r) => paperSubject.get(r.paper_id)?.slug === subjectFilter).length
        : statusRows.length,
      conceptsWithKeyword: [...conceptMap.values()].filter((e) => e.wrongCount > 0).length,
    },
    subjects,
    concepts,
    bySubject,
  };
}

// ── 오답 문항 표본(AI 코칭 입력용) ───────────────────────────────────────────
// 개념 이름과 숫자만으로는 "어떤 유형에서 무너지는지"를 말할 수 없다(모델이 문제를
// 본 적이 없으니 학습법 일반론밖에 못 낸다). 그래서 코칭 대상 개념마다 실제로 틀린
// 문항 몇 개를 발문·정답·"내가 고른 선지"까지 함께 뽑아 모델에 넣는다.
//
// 비용이 여기서 결정된다 — 문항당 약 300자를 넣으므로, 개념당 문항 수(perConcept)와
// 아래 truncate 길이가 곧 1회 요금이다. 함부로 늘리지 말 것. 문제 이미지·해설 전문은
// 넣지 않는다(문항당 1,000자를 넘겨 요금이 10배가 된다).
export type WrongQuestionSample = {
  // 개념 키(정본 id 우선, 없으면 "kw:표기"). 생성기가 개념별로 묶을 때 쓴다 — 표시
  // 이름은 과목이 다르면 겹칠 수 있어 키로 쓰면 안 된다.
  conceptKey: string;
  concept: string;
  subject: string | null;
  // 발문 요약("~옳지 않은 것을 고르는 문제입니다"). question_explanations.question_text.
  questionText: string | null;
  correctChoice: number | null;
  correctSummary: string | null;
  // 유저가 실제로 고른 오답 선지와 그 선지의 해설(왜 틀렸는지). CBT 응시 기록이 없는
  // 문항(섞어풀기만 푼 경우 등)은 null.
  pickedChoice: number | null;
  pickedReason: string | null;
};

// 모델에 넣기 전 자르는 길이. 선지 해설은 길어서 앞부분만으로도 유형 판단에 충분하다.
const SAMPLE_TEXT_MAX = 140;

function truncate(s: string | null | undefined, max = SAMPLE_TEXT_MAX): string | null {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

type ChoiceExplanation = { number?: number; explanation?: string; verdict_label?: string };

// concepts(개념 이름들)에 속하는 유저의 오답 문항을 개념당 최대 perConcept개 뽑는다.
// 아직 극복하지 못한 문항(last_is_correct=false)을 먼저, 그다음 많이 틀린 순.
export async function getWrongQuestionSamples(
  userId: string,
  targets: { conceptId: string | null; concept: string }[],
  perConcept = 6,
): Promise<WrongQuestionSample[]> {
  // 정본 개념은 id로, 미분류는 표기로 고른다(집계와 같은 키 규칙).
  const wantedIds = new Set(targets.map((t) => t.conceptId).filter((v): v is string => !!v));
  const wantedTitles = new Set(
    targets.filter((t) => !t.conceptId).map((t) => t.concept.trim()).filter(Boolean),
  );
  const displayByKey = new Map(
    targets.map((t) => [t.conceptId ?? `kw:${t.concept.trim()}`, t.concept]),
  );
  if (wantedIds.size === 0 && wantedTitles.size === 0) return [];

  const admin = createAdminClient();

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
  if (statusRows.length === 0) return [];

  // (paper, 문항번호) → question id, paper → 과목.
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];
  const questionIdByKey = new Map<string, string>();
  const paperSubject = new Map<string, string | null>();
  for (const ids of chunk(paperIds, 100)) {
    const qrows = await fetchAll<{ id: string; paper_id: string; question_number: number }>(
      admin,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids),
    );
    for (const r of qrows) questionIdByKey.set(questionKey(r.paper_id, r.question_number), r.id);

    const prows = await fetchAll<{ id: string; subjects: { name: string } | null }>(
      admin,
      "exam_papers",
      "id, subjects(name)",
      (q) => q.in("id", ids),
    );
    for (const p of prows) paperSubject.set(p.id, p.subjects?.name ?? null);
  }

  // 해설(개념·발문·정답·선지해설). 대상 개념에 속한 문항만 남긴다.
  const questionIds = [...questionIdByKey.values()];
  type ExpRow = {
    question_id: string;
    concept_id: string | null;
    keyword_title: string | null;
    question_text: string | null;
    correct_choice_number: number | null;
    correct_choice_summary: string | null;
    choice_explanations: ChoiceExplanation[] | null;
  };
  const expByQuestionId = new Map<string, ExpRow>();
  for (const ids of chunk(questionIds, 100)) {
    const rows = await fetchAll<ExpRow>(
      admin,
      "question_explanations",
      "question_id, concept_id, keyword_title, question_text, correct_choice_number, correct_choice_summary, choice_explanations",
      (q) => q.in("question_id", ids),
    );
    for (const r of rows) {
      const hit = r.concept_id
        ? wantedIds.has(r.concept_id)
        : wantedTitles.has((r.keyword_title ?? "").trim());
      if (hit) expByQuestionId.set(r.question_id, r);
    }
  }
  if (expByQuestionId.size === 0) return [];

  // 개념별로 후보를 모아 미극복 → 많이 틀린 순으로 자른다.
  type Candidate = { row: ExpRow; status: (typeof statusRows)[number]; subject: string | null };
  const byConcept = new Map<string, Candidate[]>();
  for (const st of statusRows) {
    const qid = questionIdByKey.get(questionKey(st.paper_id, st.question_number));
    if (!qid) continue;
    const exp = expByQuestionId.get(qid);
    if (!exp) continue;
    const ckey = exp.concept_id ?? `kw:${(exp.keyword_title ?? "").trim()}`;
    if (!displayByKey.has(ckey)) continue;
    const list = byConcept.get(ckey) ?? [];
    list.push({ row: exp, status: st, subject: paperSubject.get(st.paper_id) ?? null });
    byConcept.set(ckey, list);
  }

  const picked: Candidate[] = [];
  for (const list of byConcept.values()) {
    list.sort(
      (a, b) =>
        Number(a.status.last_is_correct) - Number(b.status.last_is_correct) ||
        b.status.wrong_count - a.status.wrong_count,
    );
    picked.push(...list.slice(0, perConcept));
  }
  if (picked.length === 0) return [];

  // "내가 고른 선지": 뽑힌 문항에 한해 CBT 응시 기록에서 틀린 선택을 찾는다.
  const pickedPaperIds = [...new Set(picked.map((c) => c.status.paper_id))];
  const attempts = await fetchAll<{ id: string; paper_id: string }>(
    admin,
    "cbt_attempts",
    "id, paper_id",
    (q) => q.eq("user_id", userId).in("paper_id", pickedPaperIds),
  );
  const attemptPaper = new Map(attempts.map((a) => [a.id, a.paper_id]));
  const chosenByKey = new Map<string, number>();
  for (const ids of chunk([...attemptPaper.keys()], 100)) {
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
      if (r.is_correct || r.selected_choice == null) continue;
      const paperId = attemptPaper.get(r.attempt_id);
      if (!paperId) continue;
      // 여러 번 틀렸으면 마지막 선택이 남는다(가장 최근의 오개념).
      chosenByKey.set(questionKey(paperId, r.question_number), r.selected_choice);
    }
  }

  return picked.map(({ row, status, subject }) => {
    const pickedChoice = chosenByKey.get(questionKey(status.paper_id, status.question_number)) ?? null;
    const choiceRow =
      pickedChoice != null
        ? (row.choice_explanations ?? []).find((c) => c?.number === pickedChoice)
        : undefined;
    const reason = choiceRow
      ? [choiceRow.verdict_label, choiceRow.explanation].filter(Boolean).join(" — ")
      : null;
    const conceptKey = row.concept_id ?? `kw:${(row.keyword_title ?? "").trim()}`;
    return {
      conceptKey,
      concept: displayByKey.get(conceptKey) ?? (row.keyword_title ?? "").trim(),
      subject,
      questionText: truncate(row.question_text, 100),
      correctChoice: row.correct_choice_number,
      correctSummary: truncate(row.correct_choice_summary),
      pickedChoice,
      pickedReason: truncate(reason),
    };
  });
}
