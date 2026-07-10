// 사용법: node scripts/save-explanations.mjs <결과파일.json>
//
// next-explanation-chunk.mjs가 내려준 청크에 대해 생성한 해설을 저장한다.
// 입력 JSON 형식 (배열):
// [
//   {
//     "question_id": "uuid",
//     "keyword_summary": "핵심 키워드/개념 설명",
//     "choice_explanations": [{ "number": 1, "correct": false, "explanation": "..." }, ...],
//     "proposed_answer": 3,
//     "model_version": "claude-opus-4-8"
//   },
//   ...
// ]
//
// 각 항목을 verify_question_answer()로 정답표와 대조한 뒤 question_explanations에
// upsert한다. proposed_answer/정답 자체는 question_explanations에 저장하지 않는다
// (paper_answers 유출 방지 원칙 유지 — 대조 결과 verified만 남긴다). 대조에
// 실패한(불일치) 항목도 저장은 하되 verified=false로 남기고, stdout에 mismatched로
// 모아 보고한다 — 호출한 쪽(에이전트)이 그 문항만 재검토/재생성하도록 판단 근거를 준다.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("사용법: node scripts/save-explanations.mjs <결과파일.json>");
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

  const items = JSON.parse(await readFile(inputPath, "utf-8"));
  if (!Array.isArray(items) || items.length === 0) {
    console.error("입력 JSON은 최소 1개 이상의 항목을 가진 배열이어야 합니다.");
    process.exit(1);
  }

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

  for (const item of items) {
    const { data: verified, error: verifyError } = await supabase.rpc("verify_question_answer", {
      target_question_id: item.question_id,
      proposed_answer: item.proposed_answer,
    });
    if (verifyError) {
      console.error(`정답 대조 실패 (${item.question_id}): ${verifyError.message}`);
      continue;
    }

    const { error: upsertError } = await supabase.from("question_explanations").upsert(
      {
        question_id: item.question_id,
        keyword_summary: item.keyword_summary,
        choice_explanations: item.choice_explanations,
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
      mismatched.push({ question_id: item.question_id, proposed_answer: item.proposed_answer });
    }
  }

  console.log(JSON.stringify({ saved_count: saved.length, mismatched }, null, 2));
}

main();
