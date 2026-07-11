// 사용법: npm run upload-explanations -- --file uploads/explanations/2024-국가직-국어.json
//        npm run upload-explanations -- --dir uploads/explanations
//
// 별도 루틴에서 제작한 문항 해설 JSON을 question_explanations에 upsert한다.
// (paper_id, question_number) 조합당 1건이며, 이미 있으면 덮어쓴다. 오답노트 화면은
// 이 테이블만 바라보므로, 여기로 넣는 즉시 해당 문항의 "해설 보기"가 열린다.
//
// 지원하는 JSON 형태 (파일 하나에 둘 중 하나):
// 1) 행 배열:
//    [{ "paper_id": "<uuid>", "question_number": 1, "explanation": "..." }, ...]
// 2) 문제지 단위 객체 (번호를 키로):
//    { "paper_id": "<uuid>", "explanations": { "1": "...", "2": "..." } }
//
// --dir 모드에서는 폴더의 *.json을 전부 처리하고, 성공한 파일은 <dir>/_done/ 으로
// 옮긴다(문항 크롭/정답 업로드 스크립트들과 같은 방식). 한 번호라도 검증에 실패한
// 파일은 통째로 스킵해서(부분 업로드 없음) 반쪽짜리 상태를 만들지 않는다.

import { createClient } from "@supabase/supabase-js";
import { mkdir, readdir, readFile, rename } from "node:fs/promises";
import path from "node:path";

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

function isUuid(v) {
  return typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// 파일 내용을 { paper_id, question_number, explanation } 행 배열로 정규화한다.
function normalizeRows(data, fileName) {
  const rows = [];
  if (Array.isArray(data)) {
    for (const row of data) {
      rows.push({
        paper_id: row?.paper_id,
        question_number: row?.question_number,
        explanation: row?.explanation,
      });
    }
  } else if (data && typeof data === "object" && data.explanations) {
    for (const [num, explanation] of Object.entries(data.explanations)) {
      rows.push({
        paper_id: data.paper_id,
        question_number: Number(num),
        explanation,
      });
    }
  } else {
    throw new Error(`${fileName}: 지원하지 않는 JSON 형태입니다 (배열 또는 {paper_id, explanations}).`);
  }
  return rows;
}

// 행 전체를 검증한다. 문제 하나라도 있으면 에러 목록을 돌려주고 업로드하지 않는다.
async function validateRows(supabase, rows, fileName) {
  const errors = [];
  const paperIds = [...new Set(rows.map((r) => r.paper_id))];

  for (const id of paperIds) {
    if (!isUuid(id)) errors.push(`paper_id가 UUID가 아님: ${JSON.stringify(id)}`);
  }
  if (errors.length > 0) return { errors };

  const { data: papers, error } = await supabase
    .from("exam_papers")
    .select("id, title, question_count")
    .in("id", paperIds);
  if (error) throw error;

  const paperById = new Map((papers ?? []).map((p) => [p.id, p]));
  for (const id of paperIds) {
    if (!paperById.has(id)) errors.push(`존재하지 않는 문제지: ${id}`);
  }

  const seen = new Set();
  for (const row of rows) {
    const label = `${fileName} paper=${row.paper_id} q=${row.question_number}`;
    const paper = paperById.get(row.paper_id);
    if (!Number.isInteger(row.question_number) || row.question_number < 1) {
      errors.push(`${label}: question_number가 1 이상의 정수가 아님`);
      continue;
    }
    if (paper?.question_count && row.question_number > paper.question_count) {
      errors.push(
        `${label}: 문항 수(${paper.question_count})를 벗어난 번호 — "${paper.title}"`,
      );
    }
    if (typeof row.explanation !== "string" || row.explanation.trim().length === 0) {
      errors.push(`${label}: explanation이 비어 있음`);
    }
    const key = `${row.paper_id}:${row.question_number}`;
    if (seen.has(key)) errors.push(`${label}: 파일 안에서 번호가 중복됨`);
    seen.add(key);
  }

  return { errors, paperById };
}

async function uploadFile(supabase, filePath) {
  const fileName = path.basename(filePath);
  const data = JSON.parse(await readFile(filePath, "utf8"));
  const rows = normalizeRows(data, fileName).map((r) => ({
    paper_id: r.paper_id,
    question_number: r.question_number,
    explanation: typeof r.explanation === "string" ? r.explanation.trim() : r.explanation,
  }));

  if (rows.length === 0) {
    console.warn(`⚠️  ${fileName}: 해설이 0건이라 건너뜀`);
    return false;
  }

  const { errors, paperById } = await validateRows(supabase, rows, fileName);
  if (errors.length > 0) {
    console.error(`❌ ${fileName}: 검증 실패 ${errors.length}건 — 이 파일은 업로드하지 않음`);
    for (const e of errors) console.error(`   - ${e}`);
    return false;
  }

  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500).map((r) => ({
      ...r,
      updated_at: new Date().toISOString(),
    }));
    const { error } = await supabase
      .from("question_explanations")
      .upsert(chunk, { onConflict: "paper_id,question_number" });
    if (error) throw error;
  }

  const paperSummary = [...new Set(rows.map((r) => r.paper_id))]
    .map((id) => `"${paperById.get(id).title}"`)
    .join(", ");
  console.log(`✅ ${fileName}: 해설 ${rows.length}건 업로드 — ${paperSummary}`);
  return true;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (args.file) {
    const ok = await uploadFile(supabase, args.file);
    process.exit(ok ? 0 : 1);
  }

  if (args.dir) {
    let entries;
    try {
      entries = await readdir(args.dir, { withFileTypes: true });
    } catch {
      console.error(`폴더를 찾을 수 없습니다: ${args.dir}`);
      process.exit(1);
    }
    const files = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".json"))
      .map((e) => path.join(args.dir, e.name));
    if (files.length === 0) {
      console.log(`처리할 JSON이 없습니다: ${args.dir}`);
      return;
    }

    const doneDir = path.join(args.dir, "_done");
    await mkdir(doneDir, { recursive: true });

    let okCount = 0;
    for (const filePath of files) {
      const ok = await uploadFile(supabase, filePath);
      if (ok) {
        await rename(filePath, path.join(doneDir, path.basename(filePath)));
        okCount++;
      }
    }
    console.log(`\n완료: ${okCount}/${files.length}개 파일 업로드`);
    process.exit(okCount === files.length ? 0 : 1);
  }

  console.error("사용법: --file <경로.json> 또는 --dir <폴더>");
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
