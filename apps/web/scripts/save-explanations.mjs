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
//     "model_version": "claude-opus-5"
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

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

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

    const { error: upsertError } = await supabase.from("question_explanations").upsert(
      {
        question_id: item.question_id,
        keyword_title: item.keyword_title,
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
    JSON.stringify({ saved_count: saved.length, mismatched, skipped_files: skippedFiles, deduplicated }, null, 2),
  );
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
