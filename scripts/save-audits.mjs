// 사용법: node scripts/save-audits.mjs <결과파일.json> [결과파일2.json ...]
//
// next-audit-chunk.mjs가 내려준 표본을 채점한 결과를 explanation_content_audits에
// 저장한다. 입력 JSON 형식 (배열):
// [
//   { "question_id": "uuid", "status": "passed", "issues": null, "model_version": "claude-opus-4-8" },
//   { "question_id": "uuid", "status": "failed", "issues": "제3조가 아니라 제5조. 현행 요율도 25.3%인데 11%로 서술.", "model_version": "..." },
//   ...
// ]
//
// 처리:
//   - explanation_content_audits에 upsert(onConflict question_id).
//   - status==="failed"인 문항은 question_explanations.verified=false로 내려 사용자에게
//     숨긴다(기존 숨김 메커니즘 재사용 → 관리자 미검증 검수화면에 노출). 감사 판정은
//     보수적으로("명백한 객관적 오류만 failed") 내리는 것을 전제로 하며, 애매하면
//     passed로 남겨 좋은 해설이 오판으로 숨겨지지 않게 한다(판정 지침은 루틴 프롬프트).
//
// 여러 파일을 주면 이어붙여 한 번에 저장하고, 일부 파일이 없거나/깨졌거나/빈 배열이어도
// 나머지는 저장한다(skipped_files로 보고). 같은 question_id가 여러 파일에 있으면 마지막
// 것만 저장한다(재시도 결과 파일이 뒤에 오는 관례; deduplicated로 보고).
// 저장할 항목이 하나도 없을 때만 exit 1.
//
// EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD(admin)로 로그인해서 실행한다.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

async function main() {
  const inputPaths = process.argv.slice(2);
  if (inputPaths.length === 0) {
    console.error("사용법: node scripts/save-audits.mjs <결과파일.json> [결과파일2.json ...]");
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
  for (const s of skippedFiles) console.error(`입력 파일 건너뜀: ${s.file} — ${s.reason}`);
  if (items.length === 0) {
    console.error("저장할 항목이 없습니다 (모든 입력 파일이 무효).");
    process.exit(1);
  }

  // question_id 중복 시 마지막 것만
  const byId = new Map();
  for (const item of items) byId.set(item.question_id, item);
  const deduplicated = items.length - byId.size;
  const uniqueItems = [...byId.values()];

  // status 값 검증 — 예상 밖 값은 저장하지 않고 보고
  const invalid = [];
  const valid = [];
  for (const item of uniqueItems) {
    if (item.status !== "passed" && item.status !== "failed") {
      invalid.push({ question_id: item.question_id, status: item.status });
    } else {
      valid.push(item);
    }
  }
  for (const iv of invalid) console.error(`잘못된 status 건너뜀: ${iv.question_id} — ${JSON.stringify(iv.status)}`);
  if (valid.length === 0) {
    console.error("유효한 status를 가진 항목이 없습니다.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({ email: botEmail, password: botPassword });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  const saved = [];
  const hidden = [];
  let passedCount = 0;
  let failedCount = 0;

  for (const item of valid) {
    const { error: upsertError } = await supabase.from("explanation_content_audits").upsert(
      {
        question_id: item.question_id,
        status: item.status,
        issues: item.status === "failed" ? (item.issues ?? null) : null,
        model_version: item.model_version ?? null,
      },
      { onConflict: "question_id" },
    );
    if (upsertError) {
      console.error(`감사 저장 실패 (${item.question_id}): ${upsertError.message}`);
      continue;
    }
    saved.push(item.question_id);
    if (item.status === "passed") passedCount++;

    if (item.status === "failed") {
      failedCount++;
      // 실패 → 사용자에게 숨김 (기존 verified=false 메커니즘 재사용)
      const { error: hideError } = await supabase
        .from("question_explanations")
        .update({ verified: false })
        .eq("question_id", item.question_id);
      if (hideError) {
        console.error(`숨김 처리 실패 (${item.question_id}): ${hideError.message}`);
        continue;
      }
      hidden.push(item.question_id);
    }
  }

  console.log(
    JSON.stringify(
      {
        saved_count: saved.length,
        passed: passedCount,
        failed: failedCount,
        hidden_count: hidden.length,
        skipped_files: skippedFiles,
        invalid_status: invalid,
        deduplicated,
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
