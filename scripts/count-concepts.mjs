// 사용법: node --env-file=.env.local scripts/count-concepts.mjs
//
// "개념 정리 보기" 작업 규모 산정용 읽기 전용 카운트. 아무것도 쓰지 않는다.
// 출력: 총 문항 수 / 해설 완료 문항 수(해설률) / distinct keyword_title(개념) 수를
// 세 기준(원문 그대로 · trim+공백정규화 · 소문자+영숫자만)으로, 그리고 과목별 분포.
//
// distinct 개념 수가 "B안(개념 사전) = 몇 건 새로 만들어야 하나"의 상한/하한 감이다:
//  - '원문' distinct ≈ 문항 1:1(표기 흔들림 미보정) → 상한.
//  - '정규화' distinct ≈ 표기 통일 후 → 의미 dedup의 근사 하한(완전하진 않음).

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

// 표기 흔들림 보정: 공백 정규화 / 소문자·영숫자(+한글)만 남기기.
const normSpace = (s) => s.trim().replace(/\s+/g, " ");
const normHard = (s) =>
  s
    .toLowerCase()
    .replace(/[^0-9a-z가-힣]/g, "")
    .trim();

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceKey);

  // 1) 전체 문항 수.
  const { count: totalQuestions } = await supabase
    .from("questions")
    .select("id", { count: "exact", head: true });

  // 2) 해설 행 전체(question_id + keyword_title). 문항 1개에 해설이 여러 번 생성됐을 수
  //    있으니 question_id로 유니크하게 접는다(최근 것 기준은 여기선 무의미 — 개념 카운트).
  const rows = await fetchAll(
    supabase,
    "question_explanations",
    "question_id, keyword_title",
    (q) => q,
  );

  const byQuestion = new Map(); // question_id → keyword_title(마지막 값)
  for (const r of rows) {
    if (r.keyword_title && r.keyword_title.trim()) {
      byQuestion.set(r.question_id, r.keyword_title.trim());
    }
  }
  const explainedQuestions = byQuestion.size;

  // 3) distinct 개념 3기준.
  const raw = new Set();
  const soft = new Set();
  const hard = new Set();
  for (const kw of byQuestion.values()) {
    raw.add(kw);
    soft.add(normSpace(kw));
    const h = normHard(kw);
    if (h) hard.add(h);
  }

  // 4) 과목별: 해설 문항 → paper → subject. (개념 분포까지 보려면 무거워지므로 과목별
  //    해설 문항 수만.)
  const qIds = [...byQuestion.keys()];
  const paperByQuestion = new Map();
  const paperIds = new Set();
  for (const ids of chunk(qIds, 300)) {
    const qs = await fetchAll(supabase, "questions", "id, paper_id", (q) => q.in("id", ids));
    for (const q of qs) {
      paperByQuestion.set(q.id, q.paper_id);
      paperIds.add(q.paper_id);
    }
  }
  const subjectByPaper = new Map();
  for (const ids of chunk([...paperIds], 300)) {
    const ps = await fetchAll(
      supabase,
      "exam_papers",
      "id, subjects(name)",
      (q) => q.in("id", ids),
    );
    for (const p of ps) subjectByPaper.set(p.id, p.subjects?.name ?? "(미분류)");
  }
  const bySubject = new Map();
  for (const qid of qIds) {
    const subj = subjectByPaper.get(paperByQuestion.get(qid)) ?? "(미분류)";
    bySubject.set(subj, (bySubject.get(subj) ?? 0) + 1);
  }

  const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : 0);

  console.log("── 개념 정리 규모 산정 ──");
  console.log(`총 문항 수                : ${totalQuestions ?? "?"}`);
  console.log(
    `해설 완료 문항 수         : ${explainedQuestions} (${pct(explainedQuestions, totalQuestions ?? 0)}%)`,
  );
  console.log(`distinct 개념(원문)       : ${raw.size}`);
  console.log(`distinct 개념(공백정규화) : ${soft.size}`);
  console.log(`distinct 개념(하드정규화) : ${hard.size}`);
  console.log(
    `→ 원문 대비 하드 dedup 감소율: ${pct(raw.size - hard.size, raw.size)}% 축소`,
  );
  console.log("\n── 과목별 해설 문항 수 ──");
  for (const [subj, n] of [...bySubject.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(n).padStart(6)}  ${subj}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
