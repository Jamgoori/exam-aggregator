// 사용법: node scripts/next-audit-chunk.mjs [--sample 30] [--chunk-size 10]
//
// 아직 내용감사되지 않은(explanation_content_audits에 행이 없는) 해설 중에서 무작위
// 표본을 뽑아, 병렬 채점용으로 chunk-size 단위로 잘라서 JSON으로 출력한다.
//   { done: false, chunks: [ { questions: [ {질문+해설+이미지URL}, ... ] }, ... ] }
// 표본이 하나도 남지 않으면(전부 감사됨) { done: true, chunks: [] }.
//
// 무작위 표본은 sample_unaudited_explanations(sample_size) RPC로 받는다(서버에서
// LEFT JOIN + ORDER BY random()). 이미 verified=false(숨겨진) 해설은 RPC가 제외한다.
//
// EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD(admin)로 로그인해서 실행한다.
// 이 스크립트는 아무것도 저장하지 않는다 — 순수 조회.

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

function intArg(args, key, def, min, max) {
  if (!(key in args)) return def;
  if (typeof args[key] !== "string" || !/^\d+$/.test(args[key])) {
    console.error(`--${key}는 정수여야 합니다.`);
    process.exit(1);
  }
  const v = Number(args[key]);
  if (v < min || v > max) {
    console.error(`--${key}는 ${min}~${max} 사이여야 합니다.`);
    process.exit(1);
  }
  return v;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const knownFlags = new Set(["sample", "chunk-size"]);
  for (const key of Object.keys(args)) {
    if (!knownFlags.has(key)) {
      console.error(`알 수 없는 플래그: --${key} (지원: --sample N, --chunk-size N)`);
      process.exit(1);
    }
  }
  const sample = intArg(args, "sample", 30, 1, 50);
  const chunkSize = intArg(args, "chunk-size", 10, 1, 50);

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

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({ email: botEmail, password: botPassword });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  const { data: rows, error } = await supabase.rpc("sample_unaudited_explanations", { sample_size: sample });
  if (error) {
    console.error(`표본 조회 실패: ${error.message}`);
    process.exit(1);
  }
  if (!rows || rows.length === 0) {
    console.log(JSON.stringify({ done: true, chunks: [] }));
    return;
  }

  const bucket = supabase.storage.from("exam-papers");
  const items = rows.map((r) => ({
    question_id: r.question_id,
    paper_id: r.paper_id,
    question_number: r.question_number,
    image_urls: (r.image_paths ?? []).map((p) => bucket.getPublicUrl(p).data.publicUrl),
    // 채점 대상 해설 본문(저장돼 있는 그대로)
    explanation: {
      keyword_title: r.keyword_title,
      keyword_explanation: r.keyword_explanation,
      question_text: r.question_text,
      correct_choice_number: r.correct_choice_number,
      correct_choice_summary: r.correct_choice_summary,
      choice_explanations: r.choice_explanations,
      current_answer_status: r.current_answer_status,
      current_answer_note: r.current_answer_note,
      law_basis_date: r.law_basis_date,
    },
  }));

  const chunks = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push({ questions: items.slice(i, i + chunkSize) });
  }

  console.log(JSON.stringify({ done: false, chunks }, null, 2));
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
