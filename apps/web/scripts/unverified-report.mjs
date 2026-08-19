// 사용법: node --env-file=.env.local scripts/unverified-report.mjs
//          [--days 30] [--exam 국회직] [--min 3] [--top 30] [--out report.json]
//
// 미검증(verified=false) 해설이 **어디에 몰려 있고 언제부터 늘었는지**를 판정하는
// 읽기 전용 분류 도구 (소유자 전용 — service role 키 필요). 아무것도 쓰지 않는다.
//
// 왜 따로 필요한가: unverified 급증은 원인이 최소 다섯 가지인데 /admin/explanations
// 화면은 최근 200건을 평평한 목록으로만 보여줘서 **모양이 안 보인다**. 실제로
// 2026-08-16 정답표 오염 사고는 "급증"으로 먼저 드러났고, 그걸 문제지 단위로 묶어
// 보고서야 원인이 정답표라는 게 확인됐다(docs/agents/answer-keys-tracks.md). 이
// 도구는 그 첫 판정 — 정답표를 의심할지, 크롭을 의심할지, 모델 오답으로 볼지 —
// 까지만 하고, 정답표가 의심되면 audit-answer-keys.mjs 로 넘긴다.
//
// 분류 버킷 (한 행은 하나에만 든다):
//   voided        — voided_questions 에 든 문항. 전항정답/복수정답이라 불일치가
//                   정상이다. 노이즈이므로 아래 집계에서 전부 뺀다.
//   no_answers    — 그 문제지에 paper_answers 자체가 없다. 해설이 대조할 상대가
//                   없는 것이라 정답 미등록 문제지가 배치에 들어온 신호다.
//   short_answers — answers 배열이 그 문항 번호에 못 미친다. 정답 배열 길이와
//                   문항 수가 어긋난 것(track/책형 사고의 서명 — 서기보 공통과목
//                   15문항 판에 25문항 정답을 복사한 실측 사고가 이 모양이었다).
//   real          — 위 셋이 아닌 진짜 불일치. 이것만 문제지 단위로 묶어 판정한다.
//
// real 을 문제지별로 묶은 뒤 붙이는 판정(문서의 "오독의 서명"을 그대로 옮긴 것):
//   책형_의심   — 그 문제지 문항의 절반 이상이 불일치. 책형 회전 시 우연 일치가
//                 ~20%뿐이라 열이 통째로 어긋나면 대부분이 불일치로 보인다.
//   오독_의심   — 3건 이상이 몰렸는데 문항 번호가 중간 구간에 치우쳐 있다
//                 (머리·꼬리는 맞고 중간이 틀린 2026-08-16 사고의 모양).
//   몰림        — 3건 이상 몰렸지만 위 두 모양은 아니다. 정답표 확인 대상.
//   산발        — 1~2건. 개별 문항의 모델 오답일 가능성이 높다.
//
// 판정은 어디까지나 우선순위 제안이다. 고치기 전에 반드시 원본 PDF 와 cells 의
// ai 증인(해설봇 답)을 확인할 것 — AI 가 DB 편이면 가짜 경보다.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

function intArg(value, fallback) {
  if (value === undefined || value === true) return fallback;
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const args = parseArgs(process.argv.slice(2));
const DAYS = intArg(args.days, 30);
const CLUSTER_MIN = intArg(args.min, 3);
const TOP = intArg(args.top, 30);
const EXAM_FILTER = typeof args.exam === "string" ? args.exam : null;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function pageAll(table, select) {
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order(select.split(",")[0].trim())
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table} 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

// PostgREST 의 .in() 은 URL 길이 제한이 있어 나눠 던진다(save-explanations.mjs 와 같은 이유).
async function selectIn(table, select, column, values) {
  const rows = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .in(column, values.slice(i, i + 200));
    if (error) {
      console.error(`${table} 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...(data ?? []));
  }
  return rows;
}

const [examTypes, subjects, papers, questions, answers, explanations] = [
  await pageAll("exam_types", "id, name"),
  await pageAll("subjects", "id, name"),
  await pageAll(
    "exam_papers",
    "id, title, exam_type_id, subject_id, year, round, level, track, question_count",
  ),
  await pageAll("questions", "id, paper_id, question_number"),
  await pageAll("paper_answers", "paper_id, answers, voided_questions"),
  await pageAll(
    "question_explanations",
    "question_id, verified, created_at, correct_choice_number, model_version",
  ),
];

const typeName = new Map(examTypes.map((t) => [t.id, t.name]));
const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
const paperById = new Map(papers.map((p) => [p.id, p]));
const questionById = new Map(questions.map((q) => [q.id, q]));
const answersByPaper = new Map(
  answers.map((a) => [
    a.paper_id,
    { answers: a.answers ?? [], voided: new Set(a.voided_questions ?? []) },
  ]),
);

// question_count 가 비어 있는 문제지가 있어 문항 번호 최댓값으로 보완한다.
const questionsByPaper = new Map();
const maxQnByPaper = new Map();
for (const q of questions) {
  const list = questionsByPaper.get(q.paper_id);
  if (list) list.push(q);
  else questionsByPaper.set(q.paper_id, [q]);
  const cur = maxQnByPaper.get(q.paper_id) ?? 0;
  if (q.question_number > cur) maxQnByPaper.set(q.paper_id, q.question_number);
}
const paperSize = (paper) => paper.question_count ?? maxQnByPaper.get(paper.id) ?? 0;

const matchesFilter = (paper) => {
  if (!EXAM_FILTER) return true;
  return (typeName.get(paper.exam_type_id) ?? "").includes(EXAM_FILTER);
};

// ── 1. 해설 행에 문제지 정보를 붙이고 필터링 ────────────────────────────────
const rows = [];
for (const e of explanations) {
  const question = questionById.get(e.question_id);
  if (!question) continue; // 문항이 지워진 고아 행
  const paper = paperById.get(question.paper_id);
  if (!paper || !matchesFilter(paper)) continue;
  rows.push({ ...e, question, paper });
}

const unverified = rows.filter((r) => r.verified === false);

// ── 2. 버킷 분류 ────────────────────────────────────────────────────────────
const buckets = { voided: [], no_answers: [], short_answers: [], real: [] };
for (const r of unverified) {
  const qn = r.question.question_number;
  const key = answersByPaper.get(r.paper.id);
  if (!key) {
    buckets.no_answers.push(r);
    continue;
  }
  if (key.voided.has(qn)) {
    buckets.voided.push(r);
    continue;
  }
  if (key.answers.length < qn) {
    buckets.short_answers.push(r);
    continue;
  }
  r.official = key.answers[qn - 1] ?? null;
  buckets.real.push(r);
}

// ── 3. 시간축 — 언제부터 늘었나 ─────────────────────────────────────────────
//
// 주의: question_explanations 에는 updated_at 이 없고 save-explanations 는
// upsert 라, **재생성된 행은 created_at 이 처음 만든 날짜 그대로**다. 그래서 이
// 표는 "새로 만들어진 해설"의 추이이고, 기존 해설이 재생성되며 unverified 로
// 뒤집힌 물량은 옛 날짜에 얹힌다. 정답표를 고친 뒤 verified 를 재계산한 경우도
// 마찬가지다 — 표가 밋밋한데 총량만 늘었다면 그쪽을 의심할 것.
const since = new Date(Date.now() - DAYS * 86400000);
const daily = new Map();
for (const r of rows) {
  const created = new Date(r.created_at);
  if (created < since) continue;
  const day = r.created_at.slice(0, 10);
  const entry = daily.get(day) ?? { total: 0, unverified: 0, real: 0 };
  entry.total++;
  if (r.verified === false) entry.unverified++;
  daily.set(day, entry);
}
for (const r of buckets.real) {
  const day = r.created_at.slice(0, 10);
  const entry = daily.get(day);
  if (entry) entry.real++;
}

// ── 4. 문제지별 묶음 + 판정 ─────────────────────────────────────────────────
const byPaper = new Map();
for (const r of buckets.real) {
  const list = byPaper.get(r.paper.id) ?? [];
  list.push(r);
  byPaper.set(r.paper.id, list);
}

function classify(paper, list) {
  const size = paperSize(paper);
  const ratio = size > 0 ? list.length / size : 0;
  if (ratio >= 0.5) return "책형_의심";
  if (list.length < CLUSTER_MIN) return "산발";
  // 문항 번호를 3등분해 중간 구간 쏠림을 본다 (머리·꼬리는 맞고 중간이 틀린 모양).
  if (size >= 6) {
    const third = size / 3;
    const mid = list.filter(
      (r) => r.question.question_number > third && r.question.question_number <= third * 2,
    ).length;
    if (mid / list.length >= 0.6) return "오독_의심";
  }
  return "몰림";
}

const paperReports = [];
for (const [paperId, list] of byPaper) {
  const paper = paperById.get(paperId);
  const size = paperSize(paper);
  list.sort((a, b) => a.question.question_number - b.question.question_number);
  paperReports.push({
    paper_id: paperId,
    title: paper.title,
    exam_type: typeName.get(paper.exam_type_id) ?? "?",
    subject: subjectName.get(paper.subject_id) ?? "?",
    year: paper.year,
    round: paper.round,
    level: paper.level,
    track: paper.track ?? null,
    question_count: size,
    unverified: list.length,
    ratio: size > 0 ? Number((list.length / size).toFixed(3)) : null,
    verdict: classify(paper, list),
    cells: list.map((r) => ({
      qn: r.question.question_number,
      ai: r.correct_choice_number,
      db: r.official,
    })),
  });
}
paperReports.sort((a, b) => b.unverified - a.unverified || a.title.localeCompare(b.title, "ko"));

// ── 5. 그룹별 집계 — 급증이 특정 직렬에 몰렸나 ──────────────────────────────
//
// 2026-08-09 큐 확장으로 신규 직렬(법원직·기상직·국회직·군무원·계리직·경찰)이
// 한꺼번에 배치에 들어왔다. 급증이 한 그룹에 몰려 있으면 그 직렬의 정답표 등록
// 경로부터 본다.
const groupStats = new Map();
for (const r of rows) {
  const key = `${typeName.get(r.paper.exam_type_id) ?? "?"} ${r.paper.level ?? "-"}`;
  const entry = groupStats.get(key) ?? { total: 0, unverified: 0, real: 0 };
  entry.total++;
  if (r.verified === false) entry.unverified++;
  groupStats.set(key, entry);
}
for (const r of buckets.real) {
  const key = `${typeName.get(r.paper.exam_type_id) ?? "?"} ${r.paper.level ?? "-"}`;
  const entry = groupStats.get(key);
  if (entry) entry.real++;
}

// ── 6. 모델 버전별 집계 — 모델 교체 시점과 겹치나 ───────────────────────────
const modelStats = new Map();
for (const r of rows) {
  const key = r.model_version ?? "(없음)";
  const entry = modelStats.get(key) ?? { total: 0, real: 0 };
  entry.total++;
  modelStats.set(key, entry);
}
for (const r of buckets.real) {
  const key = r.model_version ?? "(없음)";
  const entry = modelStats.get(key);
  if (entry) entry.real++;
}

// ── 7. 크롭 교차 점검 ───────────────────────────────────────────────────────
//
// 해설봇이 보는 것은 문항 이미지다. 크롭이 잘리거나 빠지면 AI 는 못 본 선지를
// 두고 답을 고르게 되고, 그 결과가 unverified 로 나온다 — 정답표는 멀쩡한데
// 급증하는 두 번째 경로다. 상위 문제지에 한해 이미지 유무를 확인한다.
const topPaperIds = paperReports.slice(0, TOP).map((p) => p.paper_id);
const topQuestionIds = topPaperIds.flatMap((id) =>
  (questionsByPaper.get(id) ?? []).map((q) => q.id),
);
const images =
  topQuestionIds.length > 0
    ? await selectIn("question_images", "question_id", "question_id", topQuestionIds)
    : [];
const withImage = new Set(images.map((i) => i.question_id));
const cropGaps = [];
for (const report of paperReports.slice(0, TOP)) {
  const paperQuestions = questionsByPaper.get(report.paper_id) ?? [];
  const missing = paperQuestions.filter((q) => !withImage.has(q.id)).length;
  const size = report.question_count;
  if (missing > 0 || (size > 0 && paperQuestions.length !== size)) {
    cropGaps.push({
      title: report.title,
      questions: paperQuestions.length,
      question_count: size,
      images_missing: missing,
    });
  }
}

// ── 출력 ────────────────────────────────────────────────────────────────────
const pct = (n, d) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : "-");

console.log(`\n== 미검증 해설 분류 ${EXAM_FILTER ? `(${EXAM_FILTER})` : "(전체)"} ==\n`);
console.log(`해설 총계        ${rows.length}건`);
console.log(`미검증           ${unverified.length}건 (${pct(unverified.length, rows.length)})`);
console.log(`  ├ voided        ${buckets.voided.length}건 — 전항정답/복수정답, 정상`);
console.log(`  ├ no_answers    ${buckets.no_answers.length}건 — 정답표 미등록 문제지`);
console.log(`  ├ short_answers ${buckets.short_answers.length}건 — 정답 배열 길이 부족(track/책형)`);
console.log(`  └ real          ${buckets.real.length}건 — 진짜 불일치, 아래에서 문제지별로 판정`);

console.log(`\n-- 최근 ${DAYS}일 생성 추이 (created_at 기준) --`);
console.log("날짜          생성    미검증   비율   real");
for (const [day, e] of [...daily.entries()].sort()) {
  console.log(
    `${day}  ${String(e.total).padStart(6)}  ${String(e.unverified).padStart(7)}  ` +
      `${pct(e.unverified, e.total).padStart(6)}  ${String(e.real).padStart(5)}`,
  );
}
console.log(
  "  ※ upsert 는 created_at 을 갱신하지 않는다. 이 표가 밋밋한데 총량이 늘었다면\n" +
    "    재생성/verified 재계산으로 기존 행이 뒤집힌 것이다.",
);

console.log(`\n-- 문제지별 real 불일치 상위 ${Math.min(TOP, paperReports.length)}장 --`);
for (const r of paperReports.slice(0, TOP)) {
  const cells = r.cells
    .slice(0, 12)
    .map((c) => `${c.qn}번(AI ${c.ai ?? "-"}/DB ${c.db ?? "-"})`)
    .join(" ");
  const more = r.cells.length > 12 ? ` …외 ${r.cells.length - 12}건` : "";
  console.log(
    `\n[${r.verdict}] ${r.title}${r.track ? ` (${r.track})` : ""} — ` +
      `${r.unverified}/${r.question_count}문항 (${pct(r.unverified, r.question_count)})`,
  );
  console.log(`  ${cells}${more}`);
}
if (paperReports.length > TOP) {
  console.log(`\n  …외 문제지 ${paperReports.length - TOP}장 (--top 으로 더 보기)`);
}

const verdictCounts = paperReports.reduce((acc, r) => {
  acc[r.verdict] = (acc[r.verdict] ?? 0) + 1;
  return acc;
}, {});
console.log("\n-- 문제지 판정 요약 --");
for (const [verdict, count] of Object.entries(verdictCounts)) {
  console.log(`${verdict.padEnd(12)} ${count}장`);
}

console.log("\n-- 그룹(시험유형·급수)별 --");
console.log("그룹                     해설      real   비율");
for (const [key, e] of [...groupStats.entries()].sort((a, b) => b[1].real - a[1].real)) {
  if (e.real === 0) continue;
  console.log(
    `${key.padEnd(24)} ${String(e.total).padStart(6)}  ${String(e.real).padStart(6)}  ` +
      `${pct(e.real, e.total).padStart(6)}`,
  );
}

console.log("\n-- 모델 버전별 --");
for (const [key, e] of [...modelStats.entries()].sort((a, b) => b[1].total - a[1].total)) {
  console.log(`${key.padEnd(24)} 해설 ${String(e.total).padStart(6)}  real ${String(e.real).padStart(6)}  ${pct(e.real, e.total)}`);
}

if (cropGaps.length > 0) {
  console.log("\n-- 크롭 점검 (상위 문제지 중 이미지가 비는 것) --");
  for (const g of cropGaps) {
    console.log(
      `${g.title} — 문항 ${g.questions}/${g.question_count ?? "?"}, 이미지 없는 문항 ${g.images_missing}개`,
    );
  }
  console.log("  ※ 해설봇은 문항 이미지를 보고 답을 고른다. 여기 걸린 문제지는 정답표가 아니라");
  console.log("    크롭을 먼저 의심할 것 (docs/agents/crop-question-images.md).");
}

console.log("\n-- 다음 행동 --");
// 급증분이 최근 생성분으로 설명되지 않으면 신규 생성이 아니라 재생성/재계산이다.
const recentUnverified = [...daily.values()].reduce((sum, e) => sum + e.unverified, 0);
if (unverified.length > 0 && recentUnverified / unverified.length < 0.2) {
  console.log(
    `· 미검증 ${unverified.length}건 중 최근 ${DAYS}일 생성분은 ${recentUnverified}건뿐이다 —\n` +
      "  배치가 새로 만든 물량이 아니라 기존 해설의 재생성이나 verified 재계산으로 뒤집힌\n" +
      "  것에 가깝다. 정답표를 최근에 UPDATE 했는지부터 확인할 것.",
  );
}
if (buckets.no_answers.length > 0) {
  console.log(`· 정답표 미등록 ${buckets.no_answers.length}건 → npm run list-pending-answers`);
}
if (buckets.short_answers.length > 0) {
  console.log(
    `· 정답 배열 길이 부족 ${buckets.short_answers.length}건 → 해당 직렬의 문항 수를 먼저 확인` +
      " (docs/agents/answer-keys-tracks.md 의 문항 수 안전장치 절)",
  );
}
const suspect = paperReports.filter((r) => r.verdict !== "산발");
if (suspect.length > 0) {
  const exams = [...new Set(suspect.map((r) => r.exam_type))];
  console.log(`· 정답표 의심 문제지 ${suspect.length}장 → 시험유형별로 감사:`);
  for (const exam of exams) {
    console.log(`    node --env-file=.env.local scripts/audit-answer-keys.mjs --exam ${exam} --out ${exam}.json`);
  }
}
if (suspect.length === 0 && buckets.real.length > 0) {
  console.log("· 전부 산발이다 — 문제지 단위 원인이 아니라 개별 문항의 모델 오답에 가깝다.");
}

if (typeof args.out === "string") {
  writeFileSync(
    args.out,
    JSON.stringify(
      {
        generated_for: EXAM_FILTER,
        totals: {
          explanations: rows.length,
          unverified: unverified.length,
          voided: buckets.voided.length,
          no_answers: buckets.no_answers.length,
          short_answers: buckets.short_answers.length,
          real: buckets.real.length,
        },
        daily: Object.fromEntries([...daily.entries()].sort()),
        papers: paperReports,
        groups: Object.fromEntries(groupStats),
        models: Object.fromEntries(modelStats),
        crop_gaps: cropGaps,
      },
      null,
      2,
    ),
  );
  console.log(`\n리포트 저장: ${args.out}`);
}
