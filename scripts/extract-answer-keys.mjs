// 사용법: npm run extract-answers -- --answer-key-id <uuid>
//
// answer_keys에 이미 업로드된 정답표 PDF 한 장을 Claude(비전)에게 읽혀서 과목별 정답
// 배열을 한 번에 추출하고, 그 시험(exam_type_id+year+level+round+track) 조건에 맞는
// 모든 exam_papers(과목별 문제지)의 paper_answers를 자동으로 채운다. choice_count와
// question_count는 관리자 화면(admin/actions.ts의 savePaperAnswers)과 동일한 규칙
// (정답 배열 자체에서 추론)으로 계산해 exam_papers에도 반영한다.
//
// 실제 추출/저장 로직은 scripts/lib/extract-answer-core.mjs에 있다 — 이 파일은 그
// 로직을 answer-key-id 하나에 대해 CLI로 실행하는 얇은 래퍼다. upload-answer-key.mjs와
// bulk-upload.mjs도 업로드 직후 같은 로직을 자동으로 호출해 "바로 풀기"가 뜨도록 한다.

import { createClient } from "@supabase/supabase-js";
import { extractAndSaveAnswers } from "./lib/extract-answer-core.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const answerKeyId = args["answer-key-id"];

  if (!answerKeyId) {
    console.error("사용법: npm run extract-answers -- --answer-key-id <uuid>");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }
  if (!anthropicApiKey) {
    console.error(".env.local에 ANTHROPIC_API_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: answerKey, error: answerKeyError } = await supabase
    .from("answer_keys")
    .select("*")
    .eq("id", answerKeyId)
    .single();

  if (answerKeyError || !answerKey) {
    console.error(`정답표를 찾을 수 없습니다: ${answerKeyId}`);
    process.exit(1);
  }

  console.log(`Claude에게 정답표 분석 요청 중... (${answerKey.file_name})`);

  const { updated, skipped, updatedPapers, corrected } = await extractAndSaveAnswers({
    supabase,
    anthropicApiKey,
    answerKey,
  });

  for (const paper of updatedPapers) {
    console.log(`완료: ${paper.title}`);
  }

  console.log(`\n총 ${updated}개 문제지 정답 저장 완료.`);
  if (corrected.length > 0) {
    console.log(`2차 검증에서 수정된 과목 (${corrected.length}개): ${corrected.join(", ")}`);
  }
  if (skipped.length > 0) {
    console.log(`건너뜀 (${skipped.length}개):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
