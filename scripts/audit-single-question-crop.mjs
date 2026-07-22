// 사용법: node --env-file=.env.local scripts/audit-single-question-crop.mjs [--exam-type X] [--level Y]
//
// "문제별 풀기"가 시험유형별로 얼마나 되는지 조사하는 읽기 전용 스크립트.
// exam_papers마다 question_images가 몇 문항 등록됐는지 세어, question_count와
// 비교해서 완전/부분/미크롭으로 나누고 시험유형×급수 단위로 집계한다.
// Storage/DB에 아무것도 쓰지 않는다.

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

async function fetchAllRows(supabase, table, columns, build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    let q = supabase.from(table).select(columns).range(from, from + 999);
    if (build) q = build(q);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const examTypeFilter = args["exam-type"];
  const levelFilter = args.level;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error(".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const examTypes = await fetchAllRows(supabase, "exam_types", "id, name");
  const examTypeById = new Map(examTypes.map((t) => [t.id, t.name]));

  const papers = await fetchAllRows(
    supabase,
    "exam_papers",
    "id, exam_type_id, year, round, level, track, title, question_count",
  );

  const questionRows = await fetchAllRows(supabase, "questions", "id, paper_id, question_number");
  const questionIdToPaperId = new Map(questionRows.map((r) => [r.id, r.paper_id]));

  const imageRows = await fetchAllRows(supabase, "question_images", "question_id");
  const croppedQuestionIds = new Set(imageRows.map((r) => r.question_id));

  // paper_id -> 크롭된(question_images 있는) question_number 개수
  const croppedCountByPaper = new Map();
  for (const q of questionRows) {
    if (!croppedQuestionIds.has(q.id)) continue;
    croppedCountByPaper.set(q.paper_id, (croppedCountByPaper.get(q.paper_id) ?? 0) + 1);
  }

  // 시험유형+급수(또는 track) 단위 집계
  const groups = new Map(); // key -> { none, partial, full, papers: [] }

  for (const paper of papers) {
    const examTypeName = examTypeById.get(paper.exam_type_id) ?? "(알수없음)";
    if (examTypeFilter && examTypeName !== examTypeFilter) continue;
    if (levelFilter && paper.level !== levelFilter) continue;

    const groupKey = `${examTypeName}|${paper.level ?? paper.track ?? "-"}`;
    if (!groups.has(groupKey)) {
      groups.set(groupKey, { examTypeName, levelOrTrack: paper.level ?? paper.track ?? "-", none: 0, partial: 0, full: 0, noCount: 0, papers: [] });
    }
    const g = groups.get(groupKey);

    const croppedCount = croppedCountByPaper.get(paper.id) ?? 0;
    const expected = paper.question_count;

    let status;
    if (!expected) {
      status = "no_count";
      g.noCount++;
    } else if (croppedCount === 0) {
      status = "none";
      g.none++;
    } else if (croppedCount < expected) {
      status = "partial";
      g.partial++;
    } else {
      status = "full";
      g.full++;
    }

    if (status !== "full") {
      g.papers.push({
        id: paper.id,
        label: `${paper.year}년 ${paper.round}회 ${paper.title}`,
        expected,
        croppedCount,
        status,
      });
    }
  }

  const sortedGroups = [...groups.values()].sort(
    (a, b) => a.examTypeName.localeCompare(b.examTypeName) || a.levelOrTrack.localeCompare(b.levelOrTrack),
  );

  console.log("=== 시험유형별 문제별 풀기(크롭) 현황 ===\n");
  console.log(
    "%-16s %-10s %6s %6s %6s %6s",
    "시험유형",
    "급수/직류",
    "완전",
    "부분",
    "미크롭",
    "count無",
  );
  for (const g of sortedGroups) {
    console.log(
      "%-16s %-10s %6d %6d %6d %6d",
      g.examTypeName,
      g.levelOrTrack,
      g.full,
      g.partial,
      g.none,
      g.noCount,
    );
  }

  console.log("\n=== 문제 있는 문제지 상세 (완전 크롭 제외) ===");
  for (const g of sortedGroups) {
    if (g.papers.length === 0) continue;
    console.log(`\n[${g.examTypeName} ${g.levelOrTrack}]`);
    for (const p of g.papers) {
      console.log(
        `  - ${p.label} (id=${p.id}): ${p.status} — 크롭 ${p.croppedCount}/${p.expected ?? "?"}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
