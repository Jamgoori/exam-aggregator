// 임시 스크립트: extract-answer-keys.mjs와 동일한 DB 반영 로직을, Claude API 호출 없이
// (Claude Code가 정답 PDF를 직접 읽어 옮겨 적은 데이터로) 수행한다.
// 사용법: node --env-file=.env.local scripts/_import-answers.mjs --data <json경로>
//
// JSON 형식:
// {
//   "examType": "지방직", "year": 2013, "level": "9급", "round": 1, "track": null,
//   "subjects": {
//     "건축계획": { "answers": [1,4,1,2,...], "voided": [] },
//     ...
//   }
// }

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";

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
  if (!args.data) {
    console.error("사용법: node scripts/_import-answers.mjs --data <json경로>");
    process.exit(1);
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const payload = JSON.parse(await readFile(args.data, "utf-8"));
  const { examType, year, level, round, track, subjects: subjectData } = payload;

  const { data: examTypeRow } = await supabase
    .from("exam_types")
    .select("id")
    .eq("name", examType)
    .single();
  if (!examTypeRow) {
    console.error(`시험종류를 찾을 수 없음: ${examType}`);
    process.exit(1);
  }

  const { data: subjects } = await supabase.from("subjects").select("id, name");
  const subjectByName = new Map(subjects.map((s) => [s.name, s.id]));

  let updated = 0;
  const skipped = [];

  for (const [subjectName, { answers, voided }] of Object.entries(subjectData)) {
    const subjectId = subjectByName.get(subjectName);
    if (!subjectId) {
      skipped.push(`${subjectName} (등록되지 않은 과목명)`);
      continue;
    }

    let papersQuery = supabase
      .from("exam_papers")
      .select("id, title")
      .eq("exam_type_id", examTypeRow.id)
      .eq("year", year)
      .eq("round", round ?? 1)
      .eq("subject_id", subjectId);
    papersQuery = level ? papersQuery.eq("level", level) : papersQuery.is("level", null);
    papersQuery = track ? papersQuery.eq("track", track) : papersQuery.is("track", null);

    const { data: papers, error: papersError } = await papersQuery;
    if (papersError) throw papersError;

    if (!papers || papers.length === 0) {
      skipped.push(`${subjectName} (일치하는 문제지 없음)`);
      continue;
    }
    if (papers.length > 1) {
      skipped.push(`${subjectName} (문제지 ${papers.length}건 중복 매칭 - 수동 확인 필요)`);
      continue;
    }

    const paper = papers[0];
    const choiceCount = Math.max(4, ...answers);

    const { error: paperUpdateError } = await supabase
      .from("exam_papers")
      .update({ choice_count: choiceCount, question_count: answers.length })
      .eq("id", paper.id);
    if (paperUpdateError) {
      skipped.push(`${paper.title} (문제지 업데이트 실패: ${paperUpdateError.message})`);
      continue;
    }

    const { error: upsertError } = await supabase.from("paper_answers").upsert(
      {
        paper_id: paper.id,
        answers,
        voided_questions: voided ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "paper_id" },
    );
    if (upsertError) {
      skipped.push(`${paper.title} (정답 저장 실패: ${upsertError.message})`);
      continue;
    }

    updated++;
    console.log(`완료: ${paper.title}`);
  }

  console.log(`\n총 ${updated}개 문제지 정답 저장 완료.`);
  if (skipped.length > 0) {
    console.log(`건너뜀 (${skipped.length}개):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
