// 사용법: node --env-file=.env.local scripts/list-pending-answer-keys.mjs
//
// 정답표(answer_keys)는 등록돼 있지만, 그 시험에 속한 과목별 문제지(exam_papers) 중
// 아직 paper_answers가 채워지지 않은 게 하나라도 있는 answer_key만 골라 보여준다.
// public read 정책이 열려 있는 테이블/RPC만 쓰므로 SUPABASE_SERVICE_ROLE_KEY 없이
// NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY만으로 동작한다.

import { createClient } from "@supabase/supabase-js";

// PostgREST는 range()를 안 주면 한 번에 최대 1000행까지만 돌려준다(db.max_rows).
// exam_papers와 has_cbt_answers_all()이 이미 1900여 건/1000여 건을 넘어서기 때문에,
// 이 한도에 걸리면 뒷부분이 조용히 잘려서 이미 입력된 정답도 "미입력"으로 오판된다.
// 1000건씩 끝까지 이어받아 진짜 전체를 모은다.
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
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !anonKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, anonKey);

  const [answerKeys, papers, { data: examTypes, error: etError }, answeredRows] =
    await Promise.all([
      fetchAll(() => supabase.from("answer_keys").select("*")),
      fetchAll(() =>
        supabase
          .from("exam_papers")
          .select("id, title, exam_type_id, year, level, round, track, subjects(name)"),
      ),
      supabase.from("exam_types").select("id, name"),
      fetchAll(() => supabase.rpc("has_cbt_answers_all")),
    ]);

  if (etError) throw etError;

  const examTypeById = new Map(examTypes.map((t) => [t.id, t.name]));
  const answeredPaperIds = new Set((answeredRows ?? []).map((r) => r.paper_id));

  // track은 키에 넣지 않는다. 법원직 정답표(track null) 한 장이 법원사무/등기사무/
  // 전산서기보/사서서기보 문제지 전체를 커버하기 때문 — 예전에는 track까지 키에 넣어
  // track 붙은 문제지가 어느 정답표에도 안 묶였고, 미입력 106건이 "미처리 0건"으로
  // 보고됐다 (2026-07-17 실측). track이 지정된 정답표(특수모집 전용)만 그 직류로 좁힌다.
  const keyOf = (r) =>
    [r.exam_type_id, r.year, r.level ?? "", r.round ?? 1].join("::");

  const papersByKey = new Map();
  for (const p of papers) {
    const k = keyOf(p);
    if (!papersByKey.has(k)) papersByKey.set(k, []);
    papersByKey.get(k).push(p);
  }

  const pending = [];
  for (const ak of answerKeys) {
    const matched = (papersByKey.get(keyOf(ak)) ?? []).filter(
      (p) => !ak.track || p.track === ak.track,
    );
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
