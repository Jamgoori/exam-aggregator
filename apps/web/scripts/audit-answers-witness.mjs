// 사용법: node --env-file=.env.local scripts/audit-answers-witness.mjs [--out report.json] [--exam 경찰]
//
// `paper_answers`(지금 입력돼 있는 정답)를 **정답표 PDF 없이** 검증하는 두 번째 축.
// 소유자 전용(service role 키 필요)이고 아무것도 쓰지 않는다.
//
// 배경: `audit-answer-keys.mjs`는 정답표 PDF의 텍스트 레이어를 정본으로 삼는다 —
// 가장 강한 증인이지만, 스캔본 정답표·파서가 못 읽는 판형·아예 정답표가 없는
// 문제지는 통째로 사각지대다 (2026-09-17 전수조사 실측: 문제지 4,869장 중 1,109장이
// 그 사각지대였다). 이 스크립트는 같은 대상을 다른 증인으로 훑는다:
//
//   1. 커버리지  — 정답 미등록 문제지, 정답표가 한 장도 없는 문제지
//   2. 구조      — 정답 배열 길이 vs `question_count`/`questions` 행, 선지 범위 밖 값,
//                  `voided_questions` 범위 밖 번호
//   3. AI 증인   — `question_explanations.correct_choice_number`(해설봇이 문제지
//                  이미지를 보고 낸 답)와 DB 정답의 셀 단위 대조. `voided` 위치는 제외.
//
// AI가 정본은 아니다. 한 문제지에서 불일치가 **3셀 이상**이면 (2026-08-16 오독 사고의
// 서명) 사람이 볼 것 — 정답표 PDF가 있으면 그쪽이 우선이고, AI가 DB 편이면 가짜
// 경보다. 반대로 1~2셀 불일치는 대부분 AI 오답이라 그 자체로는 신호가 약하다.
// 정답표 PDF로 clean 이 확인된 문제지는 AI가 뭐라 하든 정답 입력은 옳은 것이다.

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

// 키셋(cursor) 페이징. offset(range) 페이징은 깊은 페이지에서 앞쪽을 매번 다시 읽어
// questions/question_explanations 처럼 10만 행대가 되면 statement timeout 이 난다.
async function pageAll(sb, table, select, key = "id") {
  const cols = select.split(",").map((c) => c.trim());
  const query = cols.includes(key) ? select : `${key},${select}`;
  const rows = [];
  const PAGE = 1000;
  let cursor = null;
  for (;;) {
    let q = sb.from(table).select(query).order(key).limit(PAGE);
    if (cursor !== null) q = q.gt(key, cursor);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    cursor = data[data.length - 1][key];
  }
  console.error(`${table} ${rows.length}행`);
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey);

  const examTypes = await pageAll(sb, "exam_types", "id,name");
  const subjects = await pageAll(sb, "subjects", "id,name");
  const papers = await pageAll(
    sb,
    "exam_papers",
    "id,title,exam_type_id,subject_id,year,level,round,track,question_count,choice_count",
  );
  const answers = await pageAll(
    sb,
    "paper_answers",
    "paper_id,answers,voided_questions,updated_at",
    "paper_id",
  );
  const keys = await pageAll(sb, "answer_keys", "id,exam_type_id,year,level,round,track,file_name");
  const questions = await pageAll(sb, "questions", "id,paper_id,question_number");
  const expls = await pageAll(sb, "question_explanations", "question_id,correct_choice_number,verified");

  const typeName = new Map(examTypes.map((t) => [t.id, t.name]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const answersByPaper = new Map(answers.map((a) => [a.paper_id, a]));
  const questionById = new Map(questions.map((q) => [q.id, q]));
  const questionsByPaper = new Map();
  for (const q of questions) {
    if (!questionsByPaper.has(q.paper_id)) questionsByPaper.set(q.paper_id, []);
    questionsByPaper.get(q.paper_id).push(q);
  }
  const aiByPaper = new Map();
  for (const e of expls) {
    const q = questionById.get(e.question_id);
    if (!q) continue;
    if (!aiByPaper.has(q.paper_id)) aiByPaper.set(q.paper_id, []);
    aiByPaper.get(q.paper_id).push({ qn: q.question_number, ai: e.correct_choice_number, verified: e.verified });
  }

  // 정답표 커버리지. audit-answer-keys.mjs 와 같은 규칙: 그 직류 전용 정답표가 따로
  // 있으면 공용(track null) 정답표는 그 직류까지 덮지 않는다.
  function coveringKeys(paper) {
    const ownKeyTracks = new Set(
      keys
        .filter(
          (k) =>
            k.track &&
            k.exam_type_id === paper.exam_type_id &&
            k.year === paper.year &&
            k.round === paper.round &&
            k.level === paper.level,
        )
        .map((k) => k.track),
    );
    return keys.filter(
      (k) =>
        k.exam_type_id === paper.exam_type_id &&
        k.year === paper.year &&
        k.round === paper.round &&
        (k.level ? paper.level === k.level : paper.level === null) &&
        (k.track ? paper.track === k.track : !ownKeyTracks.has(paper.track)),
    );
  }

  const report = [];
  for (const p of papers) {
    if (args["exam"] && typeName.get(p.exam_type_id) !== args["exam"]) continue;
    const pa = answersByPaper.get(p.id);
    const qs = questionsByPaper.get(p.id) ?? [];
    const ai = aiByPaper.get(p.id) ?? [];
    const rec = {
      paper_id: p.id,
      title: p.title,
      exam: typeName.get(p.exam_type_id) ?? "?",
      subject: subjectName.get(p.subject_id) ?? "?",
      year: p.year,
      level: p.level,
      round: p.round,
      track: p.track,
      question_count: p.question_count,
      choice_count: p.choice_count,
      questions_rows: qs.length,
      has_answers: !!pa,
      answers_len: pa?.answers?.length ?? null,
      voided: pa?.voided_questions ?? [],
      updated_at: pa?.updated_at ?? null,
      keys: coveringKeys(p).length,
      ai_total: ai.length,
      ai_mismatch: [],
      issues: [],
    };
    report.push(rec);

    if (!pa?.answers) {
      // 문항·해설까지 들어간 문제지인데 정답만 없으면 CBT 가 아예 안 되는 상태다.
      if (qs.length > 0 || ai.length > 0) rec.issues.push("정답 미등록인데 문항/해설 있음");
      continue;
    }

    const voided = new Set(pa.voided_questions ?? []);
    if (p.question_count != null && pa.answers.length !== p.question_count)
      rec.issues.push(`길이≠question_count (${pa.answers.length}≠${p.question_count})`);
    if (qs.length > 0 && qs.length !== pa.answers.length)
      rec.issues.push(`길이≠questions 행수 (${pa.answers.length}≠${qs.length})`);

    // 선지 범위 밖 값. voided 자리는 채점에서 무조건 정답 처리되므로 영향은 없지만,
    // 규약(표기된 번호 중 첫 번째, 정답없음이면 1)에서 벗어난 자리값이라 따로 센다.
    const bad = [];
    const badVoided = [];
    for (let i = 0; i < pa.answers.length; i++) {
      const v = pa.answers[i];
      if (v != null && v >= 1 && v <= (p.choice_count ?? 4)) continue;
      (voided.has(i + 1) ? badVoided : bad).push({ qn: i + 1, v });
    }
    if (bad.length)
      rec.issues.push(
        `선지 범위 밖 ${bad.length}셀: ${bad.slice(0, 8).map((b) => `문${b.qn}=${b.v}`).join(",")}`,
      );
    if (badVoided.length)
      rec.issues.push(
        `voided 자리 규약 밖 ${badVoided.length}셀(채점 영향 없음): ${badVoided
          .map((b) => `문${b.qn}=${b.v}`)
          .join(",")}`,
      );
    const voidedOutOfRange = (pa.voided_questions ?? []).filter((n) => n < 1 || n > pa.answers.length);
    if (voidedOutOfRange.length) rec.issues.push(`voided 번호 범위 밖: ${voidedOutOfRange.join(",")}`);

    for (const a of ai) {
      if (a.ai == null || voided.has(a.qn)) continue;
      const db = pa.answers[a.qn - 1];
      if (db !== a.ai) rec.ai_mismatch.push({ qn: a.qn, db, ai: a.ai, verified: a.verified });
    }
  }

  const count = (f) => report.filter(f).length;
  console.error(`\n=== 감사 요약 (문제지 ${report.length}장) ===`);
  console.error(`정답 등록됨          ${count((r) => r.has_answers)}`);
  console.error(`정답 미등록          ${count((r) => !r.has_answers)}`);
  console.error(`정답표 PDF 0장       ${count((r) => r.keys === 0)}`);
  console.error(`구조 이슈            ${count((r) => r.issues.length > 0)}`);
  console.error(`AI 증인 1~2셀 불일치 ${count((r) => r.ai_mismatch.length > 0 && r.ai_mismatch.length < 3)}`);
  console.error(`AI 증인 3셀+ 불일치  ${count((r) => r.ai_mismatch.length >= 3)}  ← 사람이 볼 것`);
  const cells = report.reduce((s, r) => s + (r.answers_len ?? 0), 0);
  const aiCells = report.reduce((s, r) => s + r.ai_total, 0);
  const misCells = report.reduce((s, r) => s + r.ai_mismatch.length, 0);
  console.error(`셀: 정답 ${cells} / AI 해설 ${aiCells} / 불일치 ${misCells}`);

  for (const r of report.filter((r) => r.ai_mismatch.length >= 3).sort((a, b) => b.ai_mismatch.length - a.ai_mismatch.length)) {
    console.error(
      `AI불일치 ${r.title} — ${r.ai_mismatch.length}/${r.ai_total}셀: ${r.ai_mismatch
        .slice(0, 10)
        .map((m) => `문${m.qn} DB${m.db}→AI${m.ai}`)
        .join(", ")}`,
    );
  }

  const out = args["out"];
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.error(`보고서 저장: ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
