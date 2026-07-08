// 사용법: node --env-file=.env.local scripts/list-pending-answer-keys.mjs
//
// 정답표(answer_keys)는 등록돼 있지만, 그 시험에 속한 과목별 문제지(exam_papers) 중
// 아직 paper_answers가 채워지지 않은 게 하나라도 있는 answer_key만 골라 보여준다.
// public read 정책이 열려 있는 테이블/RPC만 쓰므로 SUPABASE_SERVICE_ROLE_KEY 없이
// NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY만으로 동작한다.

import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, anonKey);

  const [{ data: answerKeys, error: akError }, { data: papers, error: papersError }, { data: examTypes, error: etError }, { data: answeredRows, error: aError }] =
    await Promise.all([
      supabase.from("answer_keys").select("*"),
      supabase
        .from("exam_papers")
        .select("id, title, exam_type_id, year, level, round, track, subjects(name)"),
      supabase.from("exam_types").select("id, name"),
      supabase.rpc("has_cbt_answers_all"),
    ]);

  if (akError) throw akError;
  if (papersError) throw papersError;
  if (etError) throw etError;
  if (aError) throw aError;

  const examTypeById = new Map(examTypes.map((t) => [t.id, t.name]));
  const answeredPaperIds = new Set((answeredRows ?? []).map((r) => r.paper_id));

  const keyOf = (r) =>
    [r.exam_type_id, r.year, r.level ?? "", r.round ?? 1, r.track ?? ""].join("::");

  const papersByKey = new Map();
  for (const p of papers) {
    const k = keyOf(p);
    if (!papersByKey.has(k)) papersByKey.set(k, []);
    papersByKey.get(k).push(p);
  }

  const pending = [];
  for (const ak of answerKeys) {
    const matched = papersByKey.get(keyOf(ak)) ?? [];
    const missing = matched.filter((p) => !answeredPaperIds.has(p.id));
    if (missing.length === 0) continue;
    pending.push({ answerKey: ak, matched, missing });
  }

  console.log(`정답표 총 ${answerKeys.length}건 중 미처리 ${pending.length}건\n`);

  for (const { answerKey: ak, matched, missing } of pending) {
    const { data: pdfUrl } = supabase.storage
      .from("exam-papers")
      .getPublicUrl(ak.file_path);
    console.log(`- answer_key_id: ${ak.id}`);
    console.log(
      `  ${examTypeById.get(ak.exam_type_id) ?? "?"} ${ak.year} ${ak.level ?? ""} ${
        ak.round && ak.round !== 1 ? `${ak.round}회` : ""
      } ${ak.track ?? ""}`.replace(/\s+/g, " ").trim(),
    );
    console.log(`  PDF: ${pdfUrl.publicUrl}`);
    console.log(
      `  과목: ${matched.map((p) => p.subjects?.name ?? p.title).join(", ")}`,
    );
    console.log(`  미입력 과목: ${missing.map((p) => p.subjects?.name ?? p.title).join(", ")}`);
    console.log("");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
