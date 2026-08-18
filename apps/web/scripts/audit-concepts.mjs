// 사용법: node scripts/audit-concepts.mjs [--subject 국어] [--per 3] [--concepts 15]
//
// 이미 붙은 concept_id 가 맞는지 사람이(또는 모델이) 눈으로 볼 표본을 뽑는다.
// 읽기만 한다 — 아무것도 고치지 않는다.
//
// 왜 필요한가: 재분류 배치의 성과는 concept-inventory --verify 로 안 보인다.
// 검진의 매핑 커버리지는 별칭·그룹키(문자열 매칭) 경로만 재는데, 배치가 붙인 것은
// 그 규칙으로 재현되지 않기 때문이다. 얇은 개념·최대 점유 같은 분포 지표는 "쏠렸나"
// 만 보고 "맞나"는 못 본다. 개념당 문항 몇 개씩 실제로 읽어 보는 수밖에 없고,
// 그건 docs/agents/concept-dictionary.md 가 처음부터 요구하던 것이다
// ("숫자가 다 통과해도 개념당 문항 3개씩은 눈으로 확인할 것").
//
// 표본은 개념 단위로 뽑는다. concept_id 로 직접 거르면 question_explanations_concept_idx
// 를 타서 빠르고, exam_papers 조인을 안 거치므로 이 레포의 상시 위험인 8초
// statement timeout 도 피한다 (과목은 concepts.subject_id 가 이미 안다).
//
// 해설봇 계정으로 실행한다 (루틴 환경과 같은 자격 증명).

import { createClient } from "@supabase/supabase-js";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i++;
    }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set(["subject", "per", "concepts"]);
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      console.error(`알 수 없는 플래그: --${key} (지원: --subject 이름, --per N, --concepts M)`);
      process.exit(1);
    }
  }
  const per = Number(args["per"] ?? 3);
  const maxConcepts = Number(args["concepts"] ?? 15);
  if (!Number.isInteger(per) || per < 1 || per > 10) {
    console.error("--per 은 1~10 사이의 정수여야 합니다.");
    process.exit(1);
  }
  if (!Number.isInteger(maxConcepts) || maxConcepts < 1 || maxConcepts > 60) {
    console.error("--concepts 는 1~60 사이의 정수여야 합니다.");
    process.exit(1);
  }
  const subjectFilter = typeof args["subject"] === "string" ? args["subject"] : null;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const botEmail = process.env.EXPLANATION_BOT_EMAIL;
  const botPassword = process.env.EXPLANATION_BOT_PASSWORD;
  if (!supabaseUrl || !publishableKey || !botEmail || !botPassword) {
    console.error(
      "환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, EXPLANATION_BOT_EMAIL, EXPLANATION_BOT_PASSWORD",
    );
    process.exit(1);
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

  const { data: subjects, error: subjectsError } = await supabase.from("subjects").select("id, name");
  if (subjectsError) {
    console.error(`과목 조회 실패: ${subjectsError.message}`);
    process.exit(1);
  }
  const subjectById = new Map(subjects.map((s) => [s.id, s.name]));

  let targetSubjectIds = null;
  if (subjectFilter) {
    const hit = subjects.filter((s) => s.name === subjectFilter).map((s) => s.id);
    if (hit.length === 0) {
      console.error(`과목을 찾을 수 없습니다: ${subjectFilter}`);
      process.exit(1);
    }
    targetSubjectIds = new Set(hit);
  }

  const { data: concepts, error: conceptsError } = await supabase
    .from("concepts")
    .select("id, name, subject_id, parent_id, kind, merged_into");
  if (conceptsError) {
    console.error(`개념 조회 실패: ${conceptsError.message}`);
    process.exit(1);
  }

  // 단원(부모)에는 문항이 안 붙는다. 합쳐진 개념도 표본 대상이 아니다.
  let leaves = concepts.filter((c) => c.parent_id && !c.merged_into);
  if (targetSubjectIds) leaves = leaves.filter((c) => targetSubjectIds.has(c.subject_id));
  const unitName = new Map(concepts.map((c) => [c.id, c.name]));

  // 매번 같은 개념만 보면 감사가 의미가 없다. 섞어서 앞에서부터 maxConcepts 개.
  for (let i = leaves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [leaves[i], leaves[j]] = [leaves[j], leaves[i]];
  }

  const out = [];
  let scanned = 0;
  for (const concept of leaves) {
    if (out.length >= maxConcepts) break;
    scanned += 1;
    const { data, error } = await supabase
      .from("question_explanations")
      .select("question_id, keyword_title, question_text")
      .eq("concept_id", concept.id)
      .limit(per);
    if (error) {
      console.error(`표본 조회 실패 (${concept.name}): ${error.message}`);
      continue;
    }
    if (!data || data.length === 0) continue; // 아직 아무것도 안 붙은 개념
    out.push({
      subject: subjectById.get(concept.subject_id) ?? concept.subject_id,
      unit: unitName.get(concept.parent_id) ?? null,
      concept: concept.name,
      kind: concept.kind ?? "knowledge",
      samples: data.map((r) => ({
        question_id: r.question_id,
        keyword_title: r.keyword_title,
        question_text: r.question_text,
      })),
    });
  }

  // 표본에 등장한 과목의 정본 목록을 같이 준다. "이건 틀렸다" 로 끝내지 않고
  // "그러면 목록의 무엇이었어야 하나" 까지 말하려면 목록이 있어야 한다.
  const dictionaries = {};
  for (const subjectName of new Set(out.map((g) => g.subject))) {
    const subjectId = subjects.find((s) => s.name === subjectName)?.id;
    dictionaries[subjectName] = concepts
      .filter((c) => c.subject_id === subjectId && c.parent_id && !c.merged_into)
      .map((c) => ({
        name: c.name,
        unit: unitName.get(c.parent_id) ?? null,
        kind: c.kind ?? "knowledge",
      }));
  }

  console.log(
    JSON.stringify(
      {
        subject: subjectFilter,
        concepts_sampled: out.length,
        concepts_scanned: scanned,
        per,
        dictionaries,
        groups: out,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
