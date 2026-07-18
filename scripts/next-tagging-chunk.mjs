// 사용법: node scripts/next-tagging-chunk.mjs [--target-size 40]
//
// 경로 A(해설 텍스트 기반) 단원 태깅용 청크를 JSON으로 stdout에 출력한다.
// 대상: question_explanations가 이미 있는 문항 중 questions.unit_tag가 null인 것.
// 이미지 없이 해설의 question_text/keyword_title 텍스트만으로 분류하므로 싸고 빠르다.
//
// 청크는 항상 한 과목으로만 구성한다 — 분류 프롬프트가 "이 과목의 허용 태그 목록"
// 하나만 들고 가면 되게 하기 위해서다. 후보가 여러 과목에 걸쳐 있으면 남은 문항이
// 가장 많은 과목부터 처리한다.
//
// 태그 목록 원본은 scripts/unit-taxonomy.json (단일 진실). 과목명이 taxonomies에
// 없으면 aliases를 거쳐 해석하고, 그래도 없으면 그 과목은 건너뛰며 결과 JSON의
// unmapped_subjects로 보고한다(택소노미에 과목 추가 필요 신호).
//
// EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD로 로그인한다. 봇 계정은 admins에
// 등록돼 있어 question_explanations(admin 전용 select)를 읽을 수 있다. 정답 관련
// 데이터는 다루지 않는다.

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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

export function resolveTaxonomy(taxonomy, subjectName) {
  if (taxonomy.taxonomies[subjectName]) {
    return { key: subjectName, tags: taxonomy.taxonomies[subjectName] };
  }
  const aliased = taxonomy.aliases?.[subjectName];
  if (aliased && taxonomy.taxonomies[aliased]) {
    return { key: aliased, tags: taxonomy.taxonomies[aliased] };
  }
  return null;
}

// service role 키가 있으면 그걸로(로그인 불필요), 없으면 봇 계정 로그인으로 클라이언트를
// 만든다. 루틴 환경은 봇 계정뿐이고 소유자 로컬/일회성 실행은 service role이라 둘 다 지원.
export async function createTaggingClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;

  if (!supabaseUrl || (!serviceRoleKey && !(publishableKey && botEmail && botPassword))) {
    console.error(
      "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL + (SUPABASE_SERVICE_ROLE_KEY 또는 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY/EXPLANATION_BOT_EMAIL/EXPLANATION_BOT_PASSWORD)",
    );
    process.exit(1);
  }

  if (serviceRoleKey) {
    return createClient(supabaseUrl, serviceRoleKey);
  }

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }
  return supabase;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetSize = Number(args["target-size"] ?? 40);
  // 표본 검증 등 특정 과목만 뽑고 싶을 때 --subject "국어" 로 지정.
  const subjectFilter = args.subject ? String(args.subject) : null;
  // 한 번에 훑어올 후보 수. 과목별로 몰아 처리하기 위해 target보다 넉넉히 가져온다.
  const fetchLimit = Math.max(targetSize * 10, 400);

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const taxonomy = JSON.parse(
    await readFile(join(scriptDir, "unit-taxonomy.json"), "utf-8"),
  );

  const supabase = await createTaggingClient();

  // 해설이 있는데 아직 태그가 없는 문항. questions를 !inner로 걸어 unit_tag null
  // 필터가 부모 행(해설)까지 걸러내게 한다.
  let query = supabase
    .from("question_explanations")
    .select(
      "question_id, question_text, keyword_title, correct_choice_summary, " +
        "questions!inner(paper_id, unit_tag, exam_papers!inner(title, subject_id, subjects!inner(name)))",
    )
    .is("questions.unit_tag", null)
    .limit(fetchLimit);
  if (subjectFilter) {
    query = query.eq("questions.exam_papers.subjects.name", subjectFilter);
  }
  const { data: rows, error } = await query;
  if (error) {
    console.error(`후보 조회 실패: ${error.message}`);
    process.exit(1);
  }

  if (!rows || rows.length === 0) {
    console.log(JSON.stringify({ done: true, reason: "태깅할 문항 없음 (경로 A 완료)" }));
    return;
  }

  // 과목별로 묶는다.
  const bySubject = new Map();
  const unmappedSubjects = new Set();
  for (const row of rows) {
    const subjectName = row.questions?.exam_papers?.subjects?.name;
    if (!subjectName) continue;
    const resolved = resolveTaxonomy(taxonomy, subjectName);
    if (!resolved) {
      unmappedSubjects.add(subjectName);
      continue;
    }
    if (!bySubject.has(subjectName)) {
      bySubject.set(subjectName, { resolved, items: [] });
    }
    bySubject.get(subjectName).items.push({
      question_id: row.question_id,
      question_text: row.question_text,
      keyword_title: row.keyword_title,
      correct_choice_summary: row.correct_choice_summary,
    });
  }

  if (bySubject.size === 0) {
    console.log(
      JSON.stringify({
        done: true,
        reason: "후보는 있으나 전부 택소노미 미등록 과목",
        unmapped_subjects: [...unmappedSubjects],
      }),
    );
    return;
  }

  // 남은 문항이 가장 많은 과목부터.
  const [subjectName, group] = [...bySubject.entries()].sort(
    (a, b) => b[1].items.length - a[1].items.length,
  )[0];

  console.log(
    JSON.stringify(
      {
        done: false,
        subject: subjectName,
        taxonomy_key: group.resolved.key,
        taxonomy_version: taxonomy.version,
        allowed_tags: group.resolved.tags,
        remaining_in_fetch: rows.length,
        unmapped_subjects: [...unmappedSubjects],
        questions: group.items.slice(0, targetSize),
      },
      null,
      2,
    ),
  );
}

// 다른 스크립트(save-unit-tags.mjs)가 resolveTaxonomy를 재사용할 수 있게 export하되,
// 직접 실행일 때만 main을 돌린다.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
