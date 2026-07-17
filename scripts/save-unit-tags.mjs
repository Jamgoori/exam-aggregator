// 사용법: node scripts/save-unit-tags.mjs <결과파일.json>
//
// next-tagging-chunk.mjs가 내려준 청크를 분류한 결과를 questions.unit_tag에 저장한다.
// 입력 JSON 형식 (배열):
// [
//   { "question_id": "uuid", "unit_tag": "행정소송" },
//   ...
// ]
//
// 저장 전에 각 문항의 실제 과목을 DB에서 다시 조회해, 제안된 태그가 그 과목의
// 허용 목록(scripts/unit-taxonomy.json)에 있는지 검증한다 — 분류기가 목록 밖 태그를
// 지어내거나 다른 과목 청크와 뒤섞인 결과를 내면 그 항목만 거부하고 rejected로
// 보고한다(전체 중단 없음). 이미 태그가 있는 문항은 덮어쓴다(재태깅 = UPDATE 한 번
// 이라는 설계 그대로).

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTaxonomy } from "./next-tagging-chunk.mjs";

async function main() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error("사용법: node scripts/save-unit-tags.mjs <결과파일.json>");
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

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const taxonomy = JSON.parse(
    await readFile(join(scriptDir, "unit-taxonomy.json"), "utf-8"),
  );

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  // 문항 → 과목명 일괄 조회 (허용 태그 검증용).
  const ids = items.map((i) => i.question_id);
  const { data: questionRows, error: lookupError } = await supabase
    .from("questions")
    .select("id, exam_papers!inner(subjects!inner(name))")
    .in("id", ids);
  if (lookupError) {
    console.error(`문항 조회 실패: ${lookupError.message}`);
    process.exit(1);
  }
  const subjectById = new Map(
    (questionRows ?? []).map((q) => [q.id, q.exam_papers?.subjects?.name]),
  );

  const saved = [];
  const rejected = [];

  for (const item of items) {
    const subjectName = subjectById.get(item.question_id);
    if (!subjectName) {
      rejected.push({ ...item, reason: "존재하지 않는 question_id" });
      continue;
    }
    const resolved = resolveTaxonomy(taxonomy, subjectName);
    if (!resolved) {
      rejected.push({ ...item, reason: `택소노미 미등록 과목: ${subjectName}` });
      continue;
    }
    if (typeof item.unit_tag !== "string" || !resolved.tags.includes(item.unit_tag)) {
      rejected.push({
        ...item,
        reason: `허용 목록에 없는 태그 (과목: ${subjectName})`,
      });
      continue;
    }

    const { error: updateError } = await supabase
      .from("questions")
      .update({ unit_tag: item.unit_tag })
      .eq("id", item.question_id);
    if (updateError) {
      rejected.push({ ...item, reason: `저장 실패: ${updateError.message}` });
      continue;
    }
    saved.push(item.question_id);
  }

  console.log(JSON.stringify({ saved_count: saved.length, rejected }, null, 2));
  // 저장 0건이면 청크 전체가 실패한 것 — 호출한 에이전트가 알아채도록 실패 코드로 종료.
  if (saved.length === 0) process.exit(1);
}

main();
