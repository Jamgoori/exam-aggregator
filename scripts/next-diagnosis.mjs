// 사용법: node --env-file=.env.local scripts/next-diagnosis.mjs
//
// ai_diagnoses에서 report가 아직 비어 있는(요청됨/생성 대기) 가장 오래된 행을 하나
// 찾아서, 그 사용자의 오답·응시 통계와 취약 개념(keyword_title) 분포를 조립해 JSON으로
// stdout에 출력한다. 이 JSON을 diagnosis-prompt.md와 함께 Claude(구독)에 넣어 리포트를
// 생성하고, save-diagnosis.mjs로 저장한다 — 해설 배치와 같은 흐름이며 API 실비가 없다.
//
// 진단 입력에는 정답 자체가 전혀 들어가지 않는다(문항 번호·개념 키워드·점수 통계뿐).
// service_role로 실행(오답노트 통계는 본인만 볼 수 있어 RLS를 우회해 집계).

import { createClient } from "@supabase/supabase-js";

function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function fetchAll(supabase, table, columns, apply) {
  const rows = [];
  let from = 0;
  const SIZE = 1000;
  while (true) {
    let q = supabase.from(table).select(columns).range(from, from + SIZE - 1);
    q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < SIZE) break;
    from += SIZE;
  }
  return rows;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) 생성 대기 중인 가장 오래된 진단 요청 하나.
  const { data: pending, error: pendingError } = await supabase
    .from("ai_diagnoses")
    .select("id, user_id, diagnosis_date")
    .is("report", null)
    .order("requested_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (pendingError) {
    console.error(`대기 진단 조회 실패: ${pendingError.message}`);
    process.exit(1);
  }
  if (!pending) {
    console.log(JSON.stringify({ done: true }));
    return;
  }
  const userId = pending.user_id;

  // 2) 응시 이력(과목 포함). 과목별 정오율·추세 계산용.
  const attempts = await fetchAll(
    supabase,
    "cbt_attempts",
    "id, paper_id, score, total_questions, created_at, exam_papers!inner(subject_id, subjects(name, slug))",
    (q) => q.eq("user_id", userId).order("created_at", { ascending: true }),
  );

  const bySubject = new Map();
  for (const a of attempts) {
    const subj = a.exam_papers?.subjects;
    if (!subj) continue;
    const key = subj.slug;
    const entry =
      bySubject.get(key) ??
      { name: subj.name, slug: subj.slug, attempts: 0, scoreSum: 0, totalSum: 0, recentPct: [] };
    entry.attempts++;
    entry.scoreSum += a.score ?? 0;
    entry.totalSum += a.total_questions ?? 0;
    if (a.total_questions > 0) {
      entry.recentPct.push(Math.round(((a.score ?? 0) / a.total_questions) * 100));
    }
    bySubject.set(key, entry);
  }
  const subjects = [...bySubject.values()].map((e) => ({
    name: e.name,
    slug: e.slug,
    attempts: e.attempts,
    avgScorePct: e.totalSum > 0 ? Math.round((e.scoreSum / e.totalSum) * 100) : null,
    // 최근 최대 5회 정오율(오래된→최신). 추세 판단용.
    recentScores: e.recentPct.slice(-5),
  }));

  // 3) 한 번이라도 틀린 문항(통합 상태). 개념 분포용.
  const statusRows = await fetchAll(
    supabase,
    "user_question_status",
    "paper_id, question_number, wrong_count, last_is_correct",
    (q) => q.eq("user_id", userId).gt("wrong_count", 0),
  );

  // 4) (paper_id, question_number) → questions.id → keyword_title, 그리고 paper→subject.
  const paperIds = [...new Set(statusRows.map((r) => r.paper_id))];

  // 문항 id 매핑
  const questionKey = (pid, n) => `${pid}#${n}`;
  const questionIdByKey = new Map();
  const paperSubject = new Map();
  for (const ids of chunk(paperIds, 100)) {
    const rows = await fetchAll(
      supabase,
      "questions",
      "id, paper_id, question_number",
      (q) => q.in("paper_id", ids),
    );
    for (const r of rows) questionIdByKey.set(questionKey(r.paper_id, r.question_number), r.id);

    const papers = await fetchAll(
      supabase,
      "exam_papers",
      "id, subject_id, subjects(name, slug)",
      (q) => q.in("id", ids),
    );
    for (const p of papers) {
      paperSubject.set(p.id, p.subjects ? { name: p.subjects.name, slug: p.subjects.slug } : null);
    }
  }

  // keyword_title 조회 (question_id 기준)
  const questionIds = [...questionIdByKey.values()];
  const keywordByQuestionId = new Map();
  for (const ids of chunk(questionIds, 100)) {
    const rows = await fetchAll(
      supabase,
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

  // 5) 개념 × 과목 집계: 틀린 문항 수 / 극복(last_is_correct) 수.
  const conceptMap = new Map();
  for (const r of statusRows) {
    const qid = questionIdByKey.get(questionKey(r.paper_id, r.question_number));
    if (!qid) continue;
    const concept = keywordByQuestionId.get(qid);
    if (!concept) continue; // 해설 미생성 문항은 개념 분포에서 빠진다(통계엔 이미 반영).
    const subj = paperSubject.get(r.paper_id);
    const key = `${concept}###${subj?.slug ?? ""}`;
    const entry =
      conceptMap.get(key) ??
      { concept, subject: subj?.name ?? null, subjectSlug: subj?.slug ?? null, wrongCount: 0, resolvedCount: 0 };
    entry.wrongCount++;
    if (r.last_is_correct) entry.resolvedCount++;
    conceptMap.set(key, entry);
  }
  const concepts = [...conceptMap.values()]
    .sort((a, b) => b.wrongCount - a.wrongCount || a.resolvedCount - b.resolvedCount)
    .slice(0, 30);

  // 6) 출제 빈도(★): 각 취약 개념(keyword_title)이 전체 기출에서 얼마나 자주 나오는지.
  // 코퍼스 전체에서 같은 keyword_title을 단 해설 수를 세어(개념=문항 1:1이라 문항 빈도),
  // 이 사용자의 개념 집합 안에서 3분위(tercile)로 눌러 1~3점을 매긴다. 절대 스케일을
  // 모르므로 상대 분위로 정한다("자주 나오는데 약한 것"의 가성비 판단용).
  const uniqueConcepts = [...new Set(concepts.map((c) => c.concept))];
  const corpusCount = new Map();
  for (const kw of uniqueConcepts) {
    const { count } = await supabase
      .from("question_explanations")
      .select("question_id", { count: "exact", head: true })
      .eq("keyword_title", kw);
    corpusCount.set(kw, count ?? 0);
  }
  const counts = [...corpusCount.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const q1 = counts.length ? counts[Math.floor(counts.length / 3)] : 0;
  const q2 = counts.length ? counts[Math.floor((counts.length * 2) / 3)] : 0;
  for (const c of concepts) {
    const n = corpusCount.get(c.concept) ?? 0;
    // 분위 경계로 1~3점. 데이터가 거의 없으면(0) frequency는 넣지 않는다(화면이 뱃지 숨김).
    c.frequency = n <= 0 ? null : n > q2 ? 3 : n > q1 ? 2 : 1;
  }

  const output = {
    diagnosis_id: pending.id,
    user_id: userId,
    diagnosis_date: pending.diagnosis_date,
    totals: {
      attempts: attempts.length,
      wrongQuestions: statusRows.length,
      conceptsWithKeyword: conceptMap.size,
    },
    subjects,
    concepts,
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
