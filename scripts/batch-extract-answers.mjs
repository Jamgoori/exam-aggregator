// 사용법: npm run batch-extract-answers
//
// list-pending-answer-keys.mjs와 같은 방식으로 "정답표(answer_keys)는 있는데 그중 일부
// exam_papers에 paper_answers가 아직 없는" 정답표를 전부 찾아 extractAndSaveAnswers를
// 순서대로 실행한다. 자동 반영 로직을 upload-answer-key.mjs/bulk-upload.mjs에 붙이기
// 전에 이미 쌓여 있던 밀린 물량(기존 업로드분)을 한 번에 정리하기 위한 스크립트다.

import { createClient } from "@supabase/supabase-js";
import { extractAndSaveAnswers } from "./lib/extract-answer-core.mjs";

// PostgREST는 range()를 안 주면 한 번에 최대 1000행까지만 돌려준다(db.max_rows).
const BATCH_SIZE = 1000;

async function fetchAll(queryFn) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn().range(from, from + BATCH_SIZE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return rows;
}

async function main() {
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

  const [answerKeys, papers, answeredRows] = await Promise.all([
    fetchAll(() => supabase.from("answer_keys").select("*")),
    fetchAll(() =>
      supabase
        .from("exam_papers")
        .select("id, title, exam_type_id, year, level, round, track, subjects(name)"),
    ),
    fetchAll(() => supabase.rpc("has_cbt_answers_all")),
  ]);

  const answeredPaperIds = new Set(answeredRows.map((r) => r.paper_id));

  const keyOf = (r) =>
    [r.exam_type_id, r.year, r.level ?? "", r.round ?? 1, r.track ?? ""].join("::");

  const papersByKey = new Map();
  for (const p of papers) {
    const k = keyOf(p);
    if (!papersByKey.has(k)) papersByKey.set(k, []);
    papersByKey.get(k).push(p);
  }

  const pending = answerKeys.filter((ak) => {
    const matched = papersByKey.get(keyOf(ak)) ?? [];
    return matched.some((p) => !answeredPaperIds.has(p.id));
  });

  console.log(`정답표 총 ${answerKeys.length}건 중 미처리 ${pending.length}건 처리 시작\n`);

  let totalUpdated = 0;
  const failures = [];

  for (const [i, answerKey] of pending.entries()) {
    console.log(`[${i + 1}/${pending.length}] ${answerKey.file_name} 처리 중...`);
    try {
      const { updated, skipped } = await extractAndSaveAnswers({
        supabase,
        anthropicApiKey,
        answerKey,
      });
      totalUpdated += updated;
      console.log(`  -> ${updated}개 문제지 저장`);
      skipped.forEach((s) => console.log(`     건너뜀: ${s}`));
    } catch (err) {
      failures.push(`${answerKey.file_name} (${answerKey.id}): ${err.message}`);
      console.error(`  -> 실패: ${err.message}`);
    }
  }

  console.log(`\n총 ${totalUpdated}개 문제지 정답 저장 완료.`);
  if (failures.length > 0) {
    console.log(`실패한 정답표 (${failures.length}건):`);
    failures.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
