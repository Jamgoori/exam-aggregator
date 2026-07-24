// 법령 해설 전략 배포 스크립트 (소유자 로컬 실행용)
//
// 사용법 (레포 루트에서, .env.local에 SUPABASE_SERVICE_ROLE_KEY 필요):
//   node --env-file=.env.local scripts/deploy-law-explanations.mjs           # ① Storage 교체 + ② 삭제 대상 스캔·백업 (삭제 안 함)
//   node --env-file=.env.local scripts/deploy-law-explanations.mjs --delete  # 위 전부 + ③ 실제 삭제
//   node --env-file=.env.local scripts/deploy-law-explanations.mjs --restore backups/<백업파일>.json  # 백업 복원(upsert)
//
// 왜 이 스크립트인가: 해설 루틴 환경에는 service role 키가 없어서(봇 계정은 Storage
// 읽기조차 불가) Storage 교체·백업·삭제를 원격 세션이 수행할 수 없다. DDL 수단도
// 없으므로 백업은 CREATE TABLE AS 대신 로컬 JSON 파일로 남기고, 삭제는 PostgREST로
// id 목록을 나눠 지운다. 매칭 정규식은 scripts/sql/2026-07-12-delete-law-explanations.sql
// 의 것과 동일 (그 파일의 정규식을 바꾸면 여기도 같이 바꿀 것).
//
// 순서 보장: Storage는 save-explanations.mjs를 먼저, explanation-prompt.md를 나중에
// 올린다 (신프롬프트+구save 조합만이 위험하기 때문). 업로드 후 재다운로드로 바이트
// 일치를 검증하며, 검증 실패 시 삭제 단계로 넘어가지 않고 중단한다.
// next-explanation-chunk.mjs는 절대 올리지 않는다 — 레포 스냅샷이 Storage 실물보다
// 오래됐다(제외 과목 로직 누락).

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const BUCKET = "exam-papers";
const FILES_IN_ORDER = ["save-explanations.mjs", "explanation-prompt.md"];
const CONTENT_TYPES = {
  "save-explanations.mjs": "text/javascript",
  "explanation-prompt.md": "text/markdown",
};

// scripts/sql/2026-07-12-delete-law-explanations.sql 의 정규식과 동일해야 한다.
const LAW_REGEX =
  /「[^」]{0,30}법[^」]{0,25}」|에\s*관한\s*법률|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호|시행령|시행규칙|판례|대법원|헌법재판소|위헌|합헌|판시|동법|같은\s*법|과태료|벌칙|처벌|법령상|법적\s*근거/;

const BATCH = 1000;
const DELETE_BATCH = 100;

function isLawExplanation(row) {
  if (row.law_amendment_note != null) return true;
  if (row.current_answer_status != null) return true;
  const haystack = [
    row.keyword_title,
    row.keyword_explanation,
    row.correct_choice_summary,
    row.choice_explanations == null ? "" : JSON.stringify(row.choice_explanations),
  ]
    .filter(Boolean)
    .join(" ");
  return LAW_REGEX.test(haystack);
}

async function findStoragePath(supabase, fileName, dir = "", depth = 0) {
  if (depth > 4) return null;
  const { data, error } = await supabase.storage.from(BUCKET).list(dir, { limit: 1000 });
  if (error) throw new Error(`Storage list 실패 (${dir || "/"}): ${error.message}`);
  for (const entry of data ?? []) {
    const full = dir ? `${dir}/${entry.name}` : entry.name;
    if (entry.id == null) {
      // 폴더
      const found = await findStoragePath(supabase, fileName, full, depth + 1);
      if (found) return found;
    } else if (entry.name === fileName) {
      return full;
    }
  }
  return null;
}

async function fetchAllExplanations(supabase) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("question_explanations")
      .select("*")
      .order("id")
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`question_explanations 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH) break;
    from += BATCH;
  }
  return rows;
}

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const args = process.argv.slice(2);

  // --restore: 백업 JSON을 통째로 upsert해서 되돌린다.
  const restoreIdx = args.indexOf("--restore");
  if (restoreIdx !== -1) {
    const file = args[restoreIdx + 1];
    if (!file) {
      console.error("--restore <백업파일.json> 형식으로 지정하세요.");
      process.exit(1);
    }
    const rows = JSON.parse(await readFile(file, "utf-8"));
    console.log(`복원 대상 ${rows.length}건 upsert 중...`);
    for (let i = 0; i < rows.length; i += DELETE_BATCH) {
      const { error } = await supabase
        .from("question_explanations")
        .upsert(rows.slice(i, i + DELETE_BATCH), { onConflict: "question_id" });
      if (error) throw new Error(`복원 실패 (${i}~): ${error.message}`);
    }
    console.log("복원 완료.");
    return;
  }

  const doDelete = args.includes("--delete");

  // ① Storage 교체 -----------------------------------------------------------
  console.log("① Storage 스크립트 교체");
  for (const fileName of FILES_IN_ORDER) {
    const storagePath = await findStoragePath(supabase, fileName);
    if (!storagePath) throw new Error(`Storage에서 ${fileName}을 찾지 못했습니다 — 경로 확인 필요.`);
    const local = await readFile(path.join("scripts", fileName));
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, local, { upsert: true, contentType: CONTENT_TYPES[fileName] });
    if (upErr) throw new Error(`${fileName} 업로드 실패: ${upErr.message}`);
    const { data: down, error: downErr } = await supabase.storage.from(BUCKET).download(storagePath);
    if (downErr) throw new Error(`${fileName} 재다운로드 실패: ${downErr.message}`);
    const remote = Buffer.from(await down.arrayBuffer());
    if (!remote.equals(local)) throw new Error(`${fileName} 업로드 검증 실패: 바이트 불일치 — 중단.`);
    console.log(`  ✅ ${storagePath} 교체·검증 완료 (${local.length} bytes)`);
  }

  // ② 삭제 대상 스캔 + 백업 ---------------------------------------------------
  console.log("② 기존 법 해설 스캔");
  const all = await fetchAllExplanations(supabase);
  const targets = all.filter(isLawExplanation);
  console.log(`  전체 해설 ${all.length}건 / 삭제 대상 ${targets.length}건`);

  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const backupPath = path.join("backups", `question_explanations_law_backup_${stamp}.json`);
  await mkdir("backups", { recursive: true });
  await writeFile(backupPath, JSON.stringify(targets, null, 1));
  const written = JSON.parse(await readFile(backupPath, "utf-8"));
  if (written.length !== targets.length) throw new Error("백업 파일 검증 실패 — 중단.");
  console.log(`  ✅ 백업: ${backupPath} (${written.length}건, 대상 건수와 일치)`);

  if (!doDelete) {
    console.log("③ 삭제는 건너뜀 (--delete 플래그 없음). 건수가 예상 범위(수백 건)면 --delete로 다시 실행하세요.");
    return;
  }

  // ③ 삭제 -------------------------------------------------------------------
  console.log("③ 삭제 실행");
  const ids = targets.map((r) => r.id);
  let deleted = 0;
  for (let i = 0; i < ids.length; i += DELETE_BATCH) {
    const batch = ids.slice(i, i + DELETE_BATCH);
    const { error } = await supabase.from("question_explanations").delete().in("id", batch);
    if (error) throw new Error(`삭제 실패 (${deleted}건 삭제 후): ${error.message} — 백업(${backupPath})으로 복원 가능.`);
    deleted += batch.length;
  }
  const { count } = await supabase
    .from("question_explanations")
    .select("id", { count: "exact", head: true });
  console.log(`  ✅ ${deleted}건 삭제 완료. 남은 해설 ${count}건 (기대값: ${all.length - deleted}).`);
  console.log("완료. 이제 해설 루틴을 다시 켜면 삭제된 자리가 새 방식으로 재생성됩니다.");
}

main().catch((e) => {
  console.error(`\n중단: ${e.message}`);
  process.exit(1);
});
