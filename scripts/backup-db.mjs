// 사용법: node --env-file=.env.local scripts/backup-db.mjs [출력경로]
//
// DB의 모든 public 테이블을 service_role로 통째로 읽어 하나의 JSON 파일로 덤프한다.
// (Storage의 PDF 원본 파일은 DB가 아니라 별도 오브젝트 저장소라 포함되지 않는다.)
// paper_answers 등 RLS로 막힌 테이블도 service_role이라 전부 받아진다.

import { createClient } from "@supabase/supabase-js";
import { writeFile } from "node:fs/promises";

// schema.sql의 create table 순서대로. 복원 시 참고가 되도록 의존(FK) 순서에 가깝게 둔다.
const TABLES = [
  "subjects",
  "exam_types",
  "exam_papers",
  "admins",
  "comments",
  "difficulty_ratings",
  "answer_keys",
  "bookmarks",
  "paper_answers",
  "question_passages",
  "question_passage_images",
  "questions",
  "question_images",
  "question_explanations",
  "cbt_attempts",
  "cbt_attempt_starts",
  "cbt_attempt_answers",
  "signup_attempts",
  "profiles",
];

const BATCH = 1000;

async function fetchAllRows(supabase, table) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + BATCH - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
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
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = process.argv[2] ?? `db-backup-${stamp}.json`;

  const dump = { _meta: { created_at: new Date().toISOString(), tables: {} } };
  let total = 0;
  for (const table of TABLES) {
    const rows = await fetchAllRows(supabase, table);
    dump[table] = rows;
    dump._meta.tables[table] = rows.length;
    total += rows.length;
    console.log(`  ${table}: ${rows.length}행`);
  }
  dump._meta.total_rows = total;

  const json = JSON.stringify(dump);
  await writeFile(outPath, json);
  console.log(
    `\n백업 완료 → ${outPath} (총 ${total}행, ${(json.length / 1024 / 1024).toFixed(2)} MB)`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
