// 사용법: node --env-file=.env.local scripts/next-diagnosis.mjs
//
// ai_diagnoses에서 report가 아직 비어 있는(요청됨/생성 대기) 가장 오래된 행을 하나
// 찾아서, 그 사용자의 오답·응시 통계와 취약 개념(keyword_title) 분포를 조립해 JSON으로
// stdout에 출력한다. 이 JSON을 diagnosis-prompt.md와 함께 Claude(구독)에 넣어 리포트를
// 생성하고, save-diagnosis.mjs로 저장한다 — 해설 배치와 같은 흐름이며 API 실비가 없다.
//
// 기본 출력에는 정답 자체가 전혀 들어가지 않는다(문항 번호·개념 키워드·점수 통계뿐).
//
// --samples 를 붙이면 상위 취약 개념의 "실제로 틀린 문항" 표본(발문 요약·정답과 그 근거·
// 사용자가 고른 오답 선지와 그 선지가 틀린 이유)까지 함께 내려준다. 개념별 맞춤 극복법
// (report.conceptCoaching)은 통계만으로는 "판례 위주로 반복하세요" 수준의 일반론밖에 안
// 나와서, 문항을 봐야 유형을 짚을 수 있기 때문이다 — 온디맨드 경로(lib/diagnosis-generate.ts)가
// 모델에 넣는 것과 같은 재료다. 이 출력에는 정답이 들어가므로 파일로 남기지 말고, 남겼다면
// 리포트를 저장한 뒤 지운다.
//
// service_role로 실행(오답노트 통계는 본인만 볼 수 있어 RLS를 우회해 집계).

import { createClient } from "@supabase/supabase-js";

// --samples 로 표본을 뽑을 상위 취약 개념 수와 개념당 문항 수. 기본값은 온디맨드
// 경로의 COACH_TOP_N/SAMPLES_PER_CONCEPT 와 같게 맞춘다 — 같은 재료로 같은 품질의
// 극복법이 나와야 두 경로의 결과가 서로 어긋나지 않는다.
//
// 온디맨드 경로가 5개에 묶여 있는 건 품질이 아니라 **요금** 때문이다(유저당 개념 5 ×
// 문항 6 만큼의 실API 생성). 이 배치는 실비가 없으므로 --coach-top=N 으로 더 많은
// 개념을 덮을 수 있다. 취약 개념이 열 개 넘게 잡히는 계정에서 상위 5개만 극복법이
// 붙으면 나머지 카드가 통계만 있는 채로 남는다.
const DEFAULT_COACH_TOP_N = 5;
const SAMPLES_PER_CONCEPT = 6;
// 모델에 넣기 전 자르는 길이(diagnosis-live.ts SAMPLE_TEXT_MAX 와 동일).
const SAMPLE_TEXT_MAX = 140;

function truncate(s, max = SAMPLE_TEXT_MAX) {
  const t = (s ?? "").trim();
  if (!t) return null;
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

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
  const args = process.argv.slice(2);
  const wantSamples = args.includes("--samples");
  const topArg = args.find((a) => a.startsWith("--coach-top="));
  const coachTopN = Math.max(1, Number(topArg?.split("=")[1]) || DEFAULT_COACH_TOP_N);
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

  // 2-1) CBT 제출별 정오(cbt_attempt_answers). 문항별 정답률 집계용.
  // user_question_status엔 총 응시 수가 없어 정답률을 못 내므로, 채점 원본에서 문항별
  // 맞힘/총합을 센다. selected_choice=null(건너뜀)은 응시로 치지 않아 제외한다.
  // 주의: 이 테이블은 CBT 제출만 담는다(섞어풀기 제외) — 정답률은 "CBT 기준".
  const attemptPaper = new Map(attempts.map((a) => [a.id, a.paper_id]));
  const answerStats = new Map(); // `${paperId}#${qnum}` → { correct, total }
  const attemptIds = attempts.map((a) => a.id);
  for (const ids of chunk(attemptIds, 100)) {
    const rows = await fetchAll(
      supabase,
      "cbt_attempt_answers",
      "attempt_id, question_number, selected_choice, is_correct",
      (q) => q.in("attempt_id", ids),
    );
    for (const r of rows) {
      if (r.selected_choice == null) continue; // 건너뛴 문항 제외
      const paperId = attemptPaper.get(r.attempt_id);
      if (!paperId) continue;
      const k = `${paperId}#${r.question_number}`;
      const e = answerStats.get(k) ?? { correct: 0, total: 0 };
      e.total++;
      if (r.is_correct) e.correct++;
      answerStats.set(k, e);
    }
  }

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

  // 개념 조회. 진단 축은 정본 개념(concept_id)이다 — keyword_title 은 해설 배치가
  // 문항마다 자유롭게 쓴 문자열이라 사실상 문항 1:1이고(코퍼스 기준 개념당 1.02문항),
  // 그 축으로 집계하면 개념마다 wrongCount 가 1이 되어 "어디가 약한지"가 안 보인다.
  // 정본이 아직 안 붙은 문항만 keyword_title 표기로 남긴다(미매칭을 "기타"로 뭉치지
  // 않는다 — docs/agents/concept-dictionary.md). 화면(lib/diagnosis-live.ts)이 쓰는 축과
  // 같아야 여기서 만든 극복법이 화면의 개념 카드에 붙는다.
  const questionIds = [...questionIdByKey.values()];
  const conceptRefByQuestionId = new Map(); // question_id → { conceptId, title }
  const conceptIdsSeen = new Set();
  for (const ids of chunk(questionIds, 100)) {
    const rows = await fetchAll(
      supabase,
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

  // 정본 개념의 이름. 합쳐진 개념(merged_into)은 합쳐진 쪽 이름으로 보여준다.
  const conceptMeta = new Map();
  for (const ids of chunk([...conceptIdsSeen], 100)) {
    const rows = await fetchAll(supabase, "concepts", "id, name", (q) => q.in("id", ids));
    for (const r of rows) conceptMeta.set(r.id, { name: r.name });
  }

  // question_id → 화면 표기(정본 이름 우선) / 집계 키(정본 id 우선).
  const conceptNameOf = (qid) => {
    const ref = conceptRefByQuestionId.get(qid);
    if (!ref) return null;
    const name = (ref.conceptId ? conceptMeta.get(ref.conceptId)?.name : null) ?? ref.title;
    return name || null;
  };
  const conceptKeyOf = (qid) => {
    const ref = conceptRefByQuestionId.get(qid);
    if (!ref) return null;
    return ref.conceptId ?? `kw:${ref.title}`;
  };

  // 5) 개념 × 과목 집계: 틀린 문항 수 / 극복(last_is_correct) 수.
  const conceptMap = new Map();
  for (const r of statusRows) {
    const qid = questionIdByKey.get(questionKey(r.paper_id, r.question_number));
    if (!qid) continue;
    const concept = conceptNameOf(qid);
    const conceptId = conceptRefByQuestionId.get(qid)?.conceptId ?? null;
    if (!concept) continue; // 해설 미생성 문항은 개념 분포에서 빠진다(통계엔 이미 반영).
    const subj = paperSubject.get(r.paper_id);
    const key = `${conceptKeyOf(qid)}###${subj?.slug ?? ""}`;
    const entry =
      conceptMap.get(key) ??
      {
        concept,
        conceptId,
        subject: subj?.name ?? null,
        subjectSlug: subj?.slug ?? null,
        wrongCount: 0,
        resolvedCount: 0,
        correctSum: 0,
        answerSum: 0,
      };
    entry.wrongCount++;
    if (r.last_is_correct) entry.resolvedCount++;
    // 이 개념 취약 문항(틀린 적 있는 문항)의 CBT 정답률 누적.
    const st = answerStats.get(`${r.paper_id}#${r.question_number}`);
    if (st) {
      entry.correctSum += st.correct;
      entry.answerSum += st.total;
    }
    conceptMap.set(key, entry);
  }
  const concepts = [...conceptMap.values()]
    .map((e) => ({
      concept: e.concept,
      // 정본 개념 id(없으면 미분류). 코퍼스 빈도와 오답 표본을 이 축으로 센다.
      conceptId: e.conceptId,
      subject: e.subject,
      subjectSlug: e.subjectSlug,
      wrongCount: e.wrongCount,
      resolvedCount: e.resolvedCount,
      // CBT 정답률(%). 응시 기록이 없으면 null(화면이 극복 진행도로 대체).
      accuracyPct: e.answerSum > 0 ? Math.round((e.correctSum / e.answerSum) * 100) : null,
    }))
    .sort((a, b) => b.wrongCount - a.wrongCount || a.resolvedCount - b.resolvedCount)
    .slice(0, 30);

  // 6) 출제 빈도(★): 각 취약 개념(keyword_title)이 전체 기출에서 얼마나 자주 나오는지.
  // 코퍼스 전체에서 같은 keyword_title을 단 해설 수를 세어(개념=문항 1:1이라 문항 빈도),
  // 이 사용자의 개념 집합 안에서 3분위(tercile)로 눌러 1~3점을 매긴다. 절대 스케일을
  // 모르므로 상대 분위로 정한다("자주 나오는데 약한 것"의 가성비 판단용).
  // 정본 개념은 concept_id 로 센다(평균 15문항). 정본이 없는 것만 keyword_title 로
  // 세는데, 그 축은 문항 1:1이라 거의 항상 1이 나온다.
  const countKeyOf = (c) => c.conceptId ?? `kw:${c.concept}`;
  const uniqueTargets = new Map();
  for (const c of concepts) uniqueTargets.set(countKeyOf(c), c);
  const corpusCount = new Map();
  for (const [key, c] of uniqueTargets) {
    const base = supabase
      .from("question_explanations")
      .select("question_id", { count: "exact", head: true });
    const { count } = await (c.conceptId
      ? base.eq("concept_id", c.conceptId)
      : base.eq("keyword_title", c.concept));
    corpusCount.set(key, count ?? 0);
  }
  const counts = [...corpusCount.values()].filter((n) => n > 0).sort((a, b) => a - b);
  const q1 = counts.length ? counts[Math.floor(counts.length / 3)] : 0;
  const q2 = counts.length ? counts[Math.floor((counts.length * 2) / 3)] : 0;
  for (const c of concepts) {
    const n = corpusCount.get(countKeyOf(c)) ?? 0;
    // 분위 경계로 1~3점. 데이터가 거의 없으면(0) frequency는 넣지 않는다(화면이 뱃지 숨김).
    c.frequency = n <= 0 ? null : n > q2 ? 3 : n > q1 ? 2 : 1;
  }

  // 7) (--samples) 상위 취약 개념의 "실제로 틀린 문항" 표본. 개념별 맞춤 극복법용.
  // 고르는 규칙은 diagnosis-live.ts getWrongQuestionSamples 와 같다: 아직 극복하지
  // 못한 문항(last_is_correct=false) 먼저, 그다음 많이 틀린 순.
  let samples = null;
  if (wantSamples) {
    // 코칭 대상: 많이 틀린 순, 동률이면 정답률이 낮은 쪽 먼저.
    const targets = [...concepts]
      .sort((a, b) => b.wrongCount - a.wrongCount || (a.accuracyPct ?? 101) - (b.accuracyPct ?? 101))
      .slice(0, coachTopN);
    // 묶는 키는 표기가 아니라 개념 키다 — 표기 이름은 과목이 다르면 겹칠 수 있다.
    const wanted = new Map(targets.map((t) => [countKeyOf(t), t]));

    // 개념별 후보 문항.
    const byConcept = new Map();
    for (const r of statusRows) {
      const qid = questionIdByKey.get(questionKey(r.paper_id, r.question_number));
      if (!qid) continue;
      const ckey = conceptKeyOf(qid);
      if (!ckey || !wanted.has(ckey)) continue;
      const list = byConcept.get(ckey) ?? [];
      list.push({ qid, status: r });
      byConcept.set(ckey, list);
    }
    const picked = [];
    for (const [ckey, list] of byConcept) {
      list.sort(
        (a, b) =>
          Number(a.status.last_is_correct) - Number(b.status.last_is_correct) ||
          b.status.wrong_count - a.status.wrong_count,
      );
      const concept = wanted.get(ckey).concept;
      for (const c of list.slice(0, SAMPLES_PER_CONCEPT)) picked.push({ concept, ...c });
    }

    // 해설 본문(발문 요약·정답·선지별 해설).
    const expByQid = new Map();
    for (const ids of chunk([...new Set(picked.map((p) => p.qid))], 100)) {
      const rows = await fetchAll(
        supabase,
        "question_explanations",
        "question_id, question_text, correct_choice_number, correct_choice_summary, choice_explanations",
        (q) => q.in("question_id", ids),
      );
      for (const r of rows) expByQid.set(r.question_id, r);
    }

    // "내가 고른 선지": 뽑힌 문항의 CBT 응시 기록에서 틀린 선택(가장 최근 것).
    const pickedPaperIds = [...new Set(picked.map((p) => p.status.paper_id))];
    const sampleAttempts = attempts.filter((a) => pickedPaperIds.includes(a.paper_id));
    const chosenByKey = new Map();
    for (const ids of chunk(sampleAttempts.map((a) => a.id), 100)) {
      if (ids.length === 0) continue;
      const rows = await fetchAll(
        supabase,
        "cbt_attempt_answers",
        "attempt_id, question_number, selected_choice, is_correct",
        (q) => q.in("attempt_id", ids),
      );
      for (const r of rows) {
        if (r.is_correct || r.selected_choice == null) continue;
        const paperId = attemptPaper.get(r.attempt_id);
        if (!paperId) continue;
        chosenByKey.set(questionKey(paperId, r.question_number), r.selected_choice);
      }
    }

    samples = picked.map((p) => {
      const exp = expByQid.get(p.qid) ?? {};
      const key = questionKey(p.status.paper_id, p.status.question_number);
      const pickedChoice = chosenByKey.get(key) ?? null;
      const choiceRow =
        pickedChoice != null
          ? (exp.choice_explanations ?? []).find((c) => c?.number === pickedChoice)
          : undefined;
      const subj = paperSubject.get(p.status.paper_id);
      return {
        concept: p.concept,
        subject: subj?.name ?? null,
        questionText: truncate(exp.question_text, 100),
        correctChoice: exp.correct_choice_number ?? null,
        correctSummary: truncate(exp.correct_choice_summary),
        pickedChoice,
        pickedReason: choiceRow
          ? truncate([choiceRow.verdict_label, choiceRow.explanation].filter(Boolean).join(" — "))
          : null,
      };
    });
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
    // --samples 일 때만. 없으면 키 자체를 넣지 않는다.
    ...(samples ? { samples } : {}),
  };
  console.log(JSON.stringify(output, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
