// 사용법: node scripts/save-explanations.mjs <결과파일.json> [결과파일2.json ...]
//
// 결과 파일을 여러 개 주면 전부 이어붙여 한 번에 저장한다 (병렬 서브에이전트가
// 청크별로 따로 쓴 파일을 배치 저장할 때 사용). 저장 로직은 파일 1개일 때와 동일.
// 단, 일부 파일이 없거나/깨졌거나/빈 배열이어도 전체를 중단하지 않는다 — 그 파일만
// 건너뛰고(stdout의 skipped_files로 보고) 나머지 정상 파일은 저장한다. 병렬 생성에서
// 서브에이전트 하나가 실패했다고 나머지의 완성된 해설까지 버리면 안 되기 때문.
// 저장할 항목이 하나도 없을 때만 exit 1. 같은 question_id가 여러 파일에 있으면
// 마지막 항목만 저장한다 (재시도 결과 파일이 뒤에 오는 관례; deduplicated로 보고).
//
// next-explanation-chunk.mjs가 내려준 청크에 대해 생성한 해설을 저장한다.
// 입력 JSON 형식 (배열):
// [
//   {
//     "question_id": "uuid",
//     "keyword_title": "기능 점수(Function Point) 산정 방법",
//     "concept": "소프트웨어 규모 산정",   // 청크의 concepts 목록에서 고른 이름 (없으면 생략)
//     "keyword_explanation": "핵심 개념 설명 문단...",
//     "question_text": "문제 발문 한 줄 재구성",
//     "correct_choice_number": 4,
//     "correct_choice_summary": "정답 선지 한 줄 요약",
//     "choice_explanations": [
//       // 법령 선지의 verdict_label/explanation은 현행법 기준으로 쓴다. current_status("유효"|"개정됨"|"확인불가")와,
//       // 개정됨일 때 출제 당시 기준 한 줄 original_note가 더 붙는다.
//       { "number": 1, "verdict_label": "맞는 설명", "explanation": "현행법 기준 근거...", "current_status": "유효" },
//       { "number": 2, "verdict_label": "틀린 설명", "explanation": "현행법 기준으로 왜 틀렸는지...", "current_status": "개정됨", "original_note": "출제 당시에는 11%여서 맞는 설명이었습니다(현행 25.3%)." },
//       ...
//     ],
//     // 아래 3개는 법령 문항에서만 채운다(비법령 문항이면 전부 생략/null).
//     "current_answer_status": "동일",   // "동일" | "정답변경" | "성립불가"
//     "current_answer_note": null,        // 정답변경/성립불가 사유 한두 줄
//     "law_basis_date": "2026-07",        // 참조한 "현행"의 기준 시점
//     "model_version": "claude-opus-4-8"
//   },
//   ...
// ]
//
// correct_choice_number를 verify_question_answer()로 실제 정답표와 대조한 뒤
// question_explanations에 upsert한다(해설은 정답을 보여주는 게 목적이라
// correct_choice_number를 그대로 저장·노출한다 — CBT 채점용 paper_answers와는
// 다른 원칙). 대조에 실패한(불일치) 항목도 저장은 하되 verified=false로 남기고,
// stdout에 mismatched로 모아 보고한다 — RLS가 verified=false 행을 일반 사용자에게
// 숨기므로, 호출한 쪽(에이전트)이 그 문항만 재검토/재생성할 때까지는 비공개로 남는다.
//
// concept: next-explanation-chunk가 청크에 실어 보낸 그 과목 정본 개념 목록에서 고른
// 이름이다. 여기서 concept_id로 바꿔 단다(약점 진단이 쓸 축). 목록에 없어서
// "?새 이름" 형태로 제안한 것과, 목록에 있다고 썼는데 안 붙는 것은 나눠서 보고한다 —
// 앞은 사람이 목록에 넣을지 판단할 거리이고, 뒤는 배치가 이름을 잘못 베낀 것이다.
// 어느 쪽도 "기타"로 뭉치지 않는다(docs/agents/concept-dictionary.md).

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

// packages/core/src/concept-dictionary.ts 의 normalizeConceptAlias 와 같은 규칙이다.
//
// 사본을 두는 이유: 이 스크립트는 배치 루틴 환경에서 plain node로 돌고,
// @gongmoa/core 는 빌드 산출물이 없는 TypeScript 소스라 import 할 수 없다.
// 한쪽만 고치면 배치가 붙이는 개념과 apply-concepts 백필이 붙이는 개념이 조용히
// 달라진다 — srs.ts 사본 규칙과 같이, 반드시 둘을 함께 고칠 것.
function normalizeConceptAlias(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s·,、/()[\]{}<>"'“”‘’:;~\-–—.]/g, "");
}

// PostgREST의 .in() 은 URL 길이 제한이 있어 나눠 던진다.
async function selectIn(supabase, table, columns, column, values) {
  const rows = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(column, values.slice(i, i + 200));
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

// 과목 + 이름 복합 키. 구분자 문자(예전엔 NUL)를 쓰지 않고 JSON 배열로 만든다 — 이름에
// 어떤 문자가 들어와도 두 필드가 섞이지 않고, 이 스크립트가 루틴 프롬프트에 코드 블록
// 통째로 실려 배포되는 경로에서 이스케이프가 변형될 여지도 없앤다
// (next-explanation-chunk.mjs 의 groupKey 와 같은 방식).
function subjectScopedKey(subjectId, name) {
  return JSON.stringify([subjectId ?? null, name]);
}

// concept 이름 → concept_id. 문항이 속한 과목 안에서만 찾는다 — 별칭은 과목 안에서만
// 유일하고, 국어 "내용 일치"와 영어 "내용 일치"는 서로 다른 개념이다.
//
// 실패해도 저장은 계속한다. 개념은 나중에 백필로 붙일 수 있지만 해설 본문은 이
// 세션에서만 만들 수 있다.
async function resolveConcepts(supabase, items) {
  const report = { attached: 0, proposed: [], unmatched: [], subjects_without_dictionary: [] };
  const byQuestion = new Map();

  const wanted = items.filter((i) => typeof i.concept === "string" && i.concept.trim());
  if (wanted.length === 0) return { byQuestion, report };

  const questionRows = await selectIn(
    supabase,
    "questions",
    "id, paper_id",
    "id",
    wanted.map((i) => i.question_id),
  );
  const paperIds = [...new Set(questionRows.map((q) => q.paper_id))];
  const paperRows = await selectIn(supabase, "exam_papers", "id, subject_id", "id", paperIds);
  const subjectOfPaper = new Map(paperRows.map((p) => [p.id, p.subject_id]));
  const subjectOfQuestion = new Map(
    questionRows.map((q) => [q.id, subjectOfPaper.get(q.paper_id) ?? null]),
  );

  const subjectIds = [...new Set([...subjectOfQuestion.values()].filter(Boolean))];
  const aliasRows = await selectIn(
    supabase,
    "concept_aliases",
    "concept_id, subject_id, normalized",
    "subject_id",
    subjectIds,
  );
  const conceptByAlias = new Map();
  const subjectsWithDictionary = new Set();
  for (const a of aliasRows) {
    conceptByAlias.set(subjectScopedKey(a.subject_id, a.normalized), a.concept_id);
    subjectsWithDictionary.add(a.subject_id);
  }

  // 사전이 아직 없는 과목은 문항마다 미매칭으로 쏟아지는 게 정상이다. 그건 배치가
  // 틀린 게 아니라 사람이 아직 목록을 안 만든 것이라 따로 센다.
  const noDictionary = new Map();
  const proposed = new Map();
  const unmatched = new Map();

  for (const item of wanted) {
    const subjectId = subjectOfQuestion.get(item.question_id) ?? null;
    const raw = item.concept.trim();
    // "?" 접두는 "목록에 없어서 새로 제안한다"는 배치 쪽 표시다.
    const isProposal = raw.startsWith("?");
    const name = raw.replace(/^\?+\s*/, "").trim();
    if (!name) continue;

    const conceptId = subjectId
      ? conceptByAlias.get(subjectScopedKey(subjectId, normalizeConceptAlias(name)))
      : undefined;

    // "?"를 붙였어도 실제로 목록에 있으면 붙인다 — 이름이 맞으면 진단 분포는
    // 틀어지지 않는다. 접두는 배치의 판단일 뿐 사전보다 우선하지 않는다.
    if (conceptId) {
      byQuestion.set(item.question_id, conceptId);
      report.attached++;
      continue;
    }

    const bucket = isProposal
      ? proposed
      : subjectId && !subjectsWithDictionary.has(subjectId)
        ? noDictionary
        : unmatched;
    const key = subjectScopedKey(subjectId, name);
    const entry = bucket.get(key) ?? { concept: name, subject_id: subjectId, count: 0 };
    entry.count++;
    entry.example_question_id ??= item.question_id;
    bucket.set(key, entry);
  }

  const toList = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  report.proposed = toList(proposed);
  report.unmatched = toList(unmatched);
  report.subjects_without_dictionary = toList(noDictionary);
  return { byQuestion, report };
}

async function main() {
  const inputPaths = process.argv.slice(2);
  if (inputPaths.length === 0) {
    console.error("사용법: node scripts/save-explanations.mjs <결과파일.json> [결과파일2.json ...]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;

  if (!supabaseUrl || !publishableKey || !botEmail || !botPassword) {
    console.error(
      "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPLANATION_BOT_EMAIL, EXPLANATION_BOT_PASSWORD",
    );
    process.exit(1);
  }

  const items = [];
  const skippedFiles = [];
  for (const inputPath of inputPaths) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(inputPath, "utf-8"));
    } catch (e) {
      skippedFiles.push({ file: inputPath, reason: e.message });
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      skippedFiles.push({ file: inputPath, reason: "빈 배열이거나 배열이 아닌 JSON" });
      continue;
    }
    items.push(...parsed);
  }
  for (const s of skippedFiles) {
    console.error(`입력 파일 건너뜀: ${s.file} — ${s.reason}`);
  }
  if (items.length === 0) {
    console.error("저장할 항목이 없습니다 (모든 입력 파일이 무효).");
    process.exit(1);
  }

  // 같은 question_id가 여러 입력에 있으면 마지막 것만 저장 (재시도 파일이 뒤에 오는 관례)
  const byId = new Map();
  for (const item of items) byId.set(item.question_id, item);
  const deduplicated = items.length - byId.size;
  const uniqueItems = [...byId.values()];

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  let conceptByQuestion = new Map();
  let conceptReport = null;
  try {
    const resolved = await resolveConcepts(supabase, uniqueItems);
    conceptByQuestion = resolved.byQuestion;
    conceptReport = resolved.report;
  } catch (e) {
    console.error(`개념 매칭 실패 — 개념 없이 저장을 계속한다: ${e?.message ?? e}`);
  }

  const mismatched = [];
  const saved = [];

  for (const item of uniqueItems) {
    const { data: verified, error: verifyError } = await supabase.rpc("verify_question_answer", {
      target_question_id: item.question_id,
      proposed_answer: item.correct_choice_number,
    });
    if (verifyError) {
      console.error(`정답 대조 실패 (${item.question_id}): ${verifyError.message}`);
      continue;
    }

    // concept_id는 붙었을 때만 payload에 넣는다. null로 넣으면 upsert의 SET 목록에
    // 들어가서, 이미 백필로 붙어 있던 개념을 덮어 지운다(재저장·재생성 때).
    const conceptId = conceptByQuestion.get(item.question_id) ?? null;
    const conceptField = conceptId ? { concept_id: conceptId } : {};

    const { error: upsertError } = await supabase.from("question_explanations").upsert(
      {
        question_id: item.question_id,
        keyword_title: item.keyword_title,
        ...conceptField,
        keyword_explanation: item.keyword_explanation,
        question_text: item.question_text,
        correct_choice_number: item.correct_choice_number,
        correct_choice_summary: item.correct_choice_summary,
        choice_explanations: item.choice_explanations,
        law_amendment_note: item.law_amendment_note ?? null,
        current_answer_status: item.current_answer_status ?? null,
        current_answer_note: item.current_answer_note ?? null,
        law_basis_date: item.law_basis_date ?? null,
        verified: verified === true,
        model_version: item.model_version,
      },
      { onConflict: "question_id" },
    );
    if (upsertError) {
      console.error(`저장 실패 (${item.question_id}): ${upsertError.message}`);
      continue;
    }

    saved.push(item.question_id);
    if (verified !== true) {
      mismatched.push({ question_id: item.question_id, correct_choice_number: item.correct_choice_number });
    }
  }

  console.log(
    JSON.stringify(
      {
        saved_count: saved.length,
        mismatched,
        skipped_files: skippedFiles,
        deduplicated,
        concepts: conceptReport,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
