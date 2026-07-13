// 사용법: node --env-file=.env.local scripts/lib/get-pending-item.mjs --answer-key-id <uuid>
//
// 워크플로우 에이전트가 answer_key 하나(정답표 PDF)에 대해 필요한 메타데이터
// (시험 정보, 아직 정답이 없는 과목별 문제지 목록과 PDF 링크)를 JSON으로 받기 위한
// 헬퍼. list-pending-answer-keys.mjs와 동일한 매칭 로직을 answer-key-id 하나로 좁혀 쓴다.

import { createClient } from "@supabase/supabase-js";

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
    console.error("사용법: node scripts/lib/get-pending-item.mjs --answer-key-id <uuid>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: ak, error: akError } = await supabase
    .from("answer_keys")
    .select("*")
    .eq("id", answerKeyId)
    .single();
  if (akError || !ak) {
    console.error(`정답표를 찾을 수 없습니다: ${answerKeyId}`);
    process.exit(1);
  }

  const { data: examType } = await supabase
    .from("exam_types")
    .select("name")
    .eq("id", ak.exam_type_id)
    .single();

  let papersQuery = supabase
    .from("exam_papers")
    .select("id, file_path, subjects(name)")
    .eq("exam_type_id", ak.exam_type_id)
    .eq("year", ak.year)
    .eq("round", ak.round ?? 1);
  papersQuery = ak.level ? papersQuery.eq("level", ak.level) : papersQuery.is("level", null);
  papersQuery = ak.track ? papersQuery.eq("track", ak.track) : papersQuery.is("track", null);
  const { data: allPapers } = await papersQuery;

  const { data: answeredRows } = await supabase.rpc("has_cbt_answers_bulk", {
    target_paper_ids: (allPapers ?? []).map((p) => p.id),
  });
  const answeredIds = new Set((answeredRows ?? []).map((r) => r.paper_id));

  const missing = (allPapers ?? []).filter((p) => !answeredIds.has(p.id) && p.subjects?.name);

  const { data: pdfUrl } = supabase.storage.from("exam-papers").getPublicUrl(ak.file_path);

  const result = {
    answerKeyId: ak.id,
    examTypeName: examType?.name ?? null,
    year: ak.year,
    level: ak.level,
    round: ak.round,
    track: ak.track,
    pdfUrl: pdfUrl.publicUrl,
    subjectNames: [...new Set(missing.map((p) => p.subjects.name))],
    papers: missing.map((p) => ({
      paperId: p.id,
      subjectName: p.subjects.name,
      pdfUrl: supabase.storage.from("exam-papers").getPublicUrl(p.file_path).data.publicUrl,
    })),
  };

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
