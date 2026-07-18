// 사용법: node scripts/dump-all-tagging-chunks.mjs <출력디렉터리> [--chunk-size 100]
//
// 경로 A 대상(해설 있고 unit_tag null) 전량을 과목별로 묶어 자기완결적 청크 파일로
// <출력디렉터리>/chunk-0001.json ... 형태로 쏟아낸다. 각 파일은 한 과목만 담고
// allowed_tags를 포함해, 분류 에이전트가 다른 파일을 안 봐도 되게 한다. 순차 의존이
// 없어 워크플로가 파일별로 병렬 분류/저장할 수 있다.
//
// 청크는 과목 경계를 넘지 않는다(과목별로 나눈 뒤 chunk-size로 자름). 마지막 조각이
// 아주 작아도 그대로 둔다(과목 섞으면 allowed_tags가 섞이므로).

import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveTaxonomy } from "./next-tagging-chunk.mjs";

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    } else args._.push(argv[i]);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = args._[0];
  const chunkSize = Number(args["chunk-size"] ?? 100);
  if (!outDir) {
    console.error("사용법: node scripts/dump-all-tagging-chunks.mjs <출력디렉터리> [--chunk-size 100]");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const taxonomy = JSON.parse(await readFile(join(scriptDir, "unit-taxonomy.json"), "utf-8"));
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 전량 순회 (페이지네이션). 과목별로 모은다.
  const pageSize = 1000;
  const bySubject = new Map();
  const unmapped = new Map();
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from("question_explanations")
      .select(
        "question_id, question_text, keyword_title, correct_choice_summary, " +
          "questions!inner(unit_tag, exam_papers!inner(subjects!inner(name)))",
      )
      .is("questions.unit_tag", null)
      .range(from, from + pageSize - 1);
    if (error) {
      console.error(`조회 실패: ${error.message}`);
      process.exit(1);
    }
    for (const r of data) {
      const name = r.questions?.exam_papers?.subjects?.name;
      if (!name) continue;
      const resolved = resolveTaxonomy(taxonomy, name);
      if (!resolved) {
        unmapped.set(name, (unmapped.get(name) ?? 0) + 1);
        continue;
      }
      if (!bySubject.has(name)) bySubject.set(name, { resolved, items: [] });
      bySubject.get(name).items.push({
        question_id: r.question_id,
        question_text: r.question_text,
        keyword_title: r.keyword_title,
        correct_choice_summary: r.correct_choice_summary,
      });
    }
    if (data.length < pageSize) break;
  }

  await mkdir(outDir, { recursive: true });
  let chunkIndex = 0;
  const manifest = [];
  for (const [subject, { resolved, items }] of bySubject) {
    for (let i = 0; i < items.length; i += chunkSize) {
      chunkIndex++;
      const slice = items.slice(i, i + chunkSize);
      const fileName = `chunk-${String(chunkIndex).padStart(4, "0")}.json`;
      await writeFile(
        join(outDir, fileName),
        JSON.stringify(
          {
            subject,
            taxonomy_key: resolved.key,
            taxonomy_version: taxonomy.version,
            allowed_tags: resolved.tags,
            questions: slice,
          },
          null,
          2,
        ),
      );
      manifest.push({ file: fileName, subject, count: slice.length });
    }
  }

  await writeFile(join(outDir, "manifest.json"), JSON.stringify({ chunks: manifest, unmapped: [...unmapped.entries()] }, null, 2));
  const total = manifest.reduce((a, m) => a + m.count, 0);
  console.log(
    JSON.stringify(
      {
        chunk_count: manifest.length,
        total_questions: total,
        subjects: bySubject.size,
        unmapped: [...unmapped.entries()],
      },
      null,
      2,
    ),
  );
}

main();
