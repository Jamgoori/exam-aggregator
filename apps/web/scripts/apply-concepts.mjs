// 사용법: npm run apply-concepts -- --file concepts.json --subject 국어 --dry-run
//         npm run apply-concepts -- --file concepts.json --subject 국어
//         npm run apply-concepts -- --file concepts.json            (전 과목 — 검증 후에만)
//
// 정본 개념 목록을 등록하고 기존 해설에 concept_id 를 붙인다
// (쓰기, 소유자 전용 — service role 키 필요).
//
// 입력 형식(concept-inventory --draft 로 뽑은 초안을 사람이 손본 것):
//
//   {
//     "정보보호론": [
//       { "name": "대칭키 암호", "unit": "암호학",
//         "aliases": ["대칭키 암호", "대칭키 암호화 방식", "대칭키 알고리즘"] },
//       { "name": "공개키 기반구조", "unit": "암호학", "aliases": ["공개키 기반구조", "PKI"] }
//     ]
//   }
//
//   - name   : 정본 이름(화면에 보이는 값). 나중에 바꿔도 되지만 id 는 유지된다
//   - unit   : 단원(대분류). 없으면 이 개념 자체가 단원이 된다
//   - aliases: keyword_title 로 실제 등장하는 표기들. 초안의 {title,count} 형태도 받는다
//
// 재실행해도 안전하다(idempotent). 이름으로 개념을 찾아 없으면 만들고, 별칭은
// 없는 것만 넣고, concept_id 는 달라진 문항만 고친다.
//
// 원칙:
//  - keyword_title 원본은 절대 건드리지 않는다(화면에 그대로 보여주는 값)
//  - 이미 다른 개념에 붙어 있는 별칭은 조용히 옮기지 않는다. 보고하고 건너뛴다 —
//    별칭이 두 개념 사이를 오가면 진단 분포가 소리 없이 흔들린다
//  - 매칭 안 되는 표기는 "기타"로 뭉치지 않는다. 미매칭으로 남겨 사람이 본다
//
// 전 과목 일괄 실행 금지. 과목 하나로 먼저 돌리고 concept-inventory --verify 를
// 통과한 뒤 나머지로 넘어갈 것.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { buildConceptLookup, matchConcept, normalizeConceptAlias } from "@gongmoa/core";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceRoleKey);

function argOf(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
}
const filePath = argOf("file");
const subjectFilter = argOf("subject");
const dryRun = process.argv.includes("--dry-run");

if (!filePath) {
  console.error("--file <정본 목록 JSON> 이 필요하다");
  process.exit(1);
}

const spec = JSON.parse(readFileSync(filePath, "utf8"));
const PAGE = 1000;

async function pageAll(table, select) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table} 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const subjects = await pageAll("subjects", "id, name");
const subjectIdByName = new Map(subjects.map((s) => [s.name, s.id]));

const papers = await pageAll("exam_papers", "id, subject_id");
const subjectOfPaper = new Map(papers.map((p) => [p.id, p.subject_id]));
const questions = await pageAll("questions", "id, paper_id");
const subjectOfQuestion = new Map();
for (const q of questions) {
  const subjectId = subjectOfPaper.get(q.paper_id);
  if (subjectId) subjectOfQuestion.set(q.id, subjectId);
}

const targets = Object.keys(spec).filter((name) => !subjectFilter || name === subjectFilter);
if (targets.length === 0) {
  console.error(`목록에 없는 과목이다: ${subjectFilter}`);
  process.exit(1);
}
if (!subjectFilter && targets.length > 1) {
  console.log(
    "※ 전 과목 일괄 실행이다. 과목 하나로 먼저 돌리고 --verify 를 통과했는지 확인할 것.\n",
  );
}

console.log(dryRun ? "\n[dry-run] 쓰지 않는다\n" : "\n개념 등록·매핑\n");

for (const subjectName of targets) {
  const subjectId = subjectIdByName.get(subjectName);
  if (!subjectId) {
    console.error(`과목을 찾을 수 없다: ${subjectName}`);
    process.exitCode = 1;
    continue;
  }

  const entries = spec[subjectName] ?? [];
  console.log(`── ${subjectName} (개념 ${entries.length})`);

  // 1) 단원 먼저. 개념의 parent_id 가 단원을 가리키므로 순서가 있다.
  const unitNames = [...new Set(entries.map((e) => e.unit).filter(Boolean))];
  const conceptIdByName = new Map();

  for (const name of [...unitNames, ...entries.map((e) => e.name)]) {
    if (conceptIdByName.has(name)) continue;
    const id = await ensureConcept(subjectId, name, null);
    if (id) conceptIdByName.set(name, id);
  }

  // 2) 단원 연결. 이름이 같은 단원을 개념으로도 쓴 경우(unit 없이 등록) 자기 자신을
  //    부모로 걸지 않는다.
  for (const entry of entries) {
    if (!entry.unit || entry.unit === entry.name) continue;
    const childId = conceptIdByName.get(entry.name);
    const parentId = conceptIdByName.get(entry.unit);
    if (childId && parentId) await setParent(childId, parentId);
  }

  // 3) 별칭. 정본 이름 자체도 별칭으로 넣는다(그래야 이름 그대로 쓴 해설이 붙는다).
  let aliasAdded = 0;
  let aliasConflict = 0;
  for (const entry of entries) {
    const conceptId = conceptIdByName.get(entry.name);
    if (!conceptId) continue;
    const list = [entry.name, ...(entry.aliases ?? []).map((a) => (typeof a === "string" ? a : a.title))];
    for (const alias of [...new Set(list)]) {
      const result = await ensureAlias(conceptId, alias);
      if (result === "added") aliasAdded++;
      if (result === "conflict") aliasConflict++;
    }
  }
  console.log(`   별칭 추가 ${aliasAdded}${aliasConflict > 0 ? ` · 충돌 ${aliasConflict}` : ""}`);

  // 4) 백필. 이 과목 해설에 concept_id 를 붙인다.
  const aliasRows = await pageAll("concept_aliases", "concept_id, alias");
  const conceptRows = await pageAll("concepts", "id, subject_id");
  const conceptSubject = new Map(conceptRows.map((c) => [c.id, c.subject_id]));
  const lookup = buildConceptLookup(
    aliasRows
      .filter((a) => conceptSubject.get(a.concept_id) === subjectId)
      .map((a) => ({ conceptId: a.concept_id, alias: a.alias })),
  );

  const explanations = await pageAll(
    "question_explanations",
    "id, question_id, keyword_title, concept_id",
  );
  const mine = explanations.filter(
    (e) => subjectOfQuestion.get(e.question_id) === subjectId && e.keyword_title,
  );

  let updated = 0;
  let unmatched = 0;
  const unmatchedTitles = new Map();

  for (const e of mine) {
    const { conceptId } = matchConcept(e.keyword_title, lookup);
    if (!conceptId) {
      unmatched++;
      unmatchedTitles.set(e.keyword_title, (unmatchedTitles.get(e.keyword_title) ?? 0) + 1);
      continue;
    }
    if (e.concept_id === conceptId) continue;
    updated++;
    if (dryRun) continue;
    const { error } = await supabase
      .from("question_explanations")
      .update({ concept_id: conceptId })
      .eq("id", e.id);
    if (error) {
      console.error(`   백필 실패 (${e.id}): ${error.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`   문항 ${mine.length} · 새로 붙임 ${updated} · 미매칭 ${unmatched}`);
  if (unmatchedTitles.size > 0) {
    const top = [...unmatchedTitles.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([title, n]) => `${title}(${n})`);
    console.log(`   미매칭 표기: ${top.join(" / ")}`);
    console.log("   → 별칭으로 넣을지, 새 개념으로 세울지 사람이 판단할 것. 기타로 뭉치지 말 것.");
  }
  console.log();
}

console.log(
  dryRun
    ? "[dry-run] 끝. 실제로 쓰려면 --dry-run 을 빼고 다시 돌릴 것.\n"
    : "끝. 검진: npm run concept-inventory -- --verify\n",
);

async function ensureConcept(subjectId, name, parentId) {
  const { data: found } = await supabase
    .from("concepts")
    .select("id")
    .eq("subject_id", subjectId)
    .ilike("name", name)
    .maybeSingle();
  if (found) return found.id;
  if (dryRun) return `dry:${name}`;

  const { data, error } = await supabase
    .from("concepts")
    .insert({ subject_id: subjectId, name, parent_id: parentId })
    .select("id")
    .maybeSingle();
  if (error) {
    console.error(`   개념 등록 실패 (${name}): ${error.message}`);
    process.exitCode = 1;
    return null;
  }
  return data?.id ?? null;
}

async function setParent(childId, parentId) {
  if (dryRun || childId === parentId) return;
  await supabase.from("concepts").update({ parent_id: parentId }).eq("id", childId);
}

// 이미 다른 개념에 붙은 별칭은 옮기지 않는다. 별칭이 개념 사이를 오가면 진단
// 분포가 소리 없이 흔들리고, 그건 화면에 아무 표시도 안 난다.
async function ensureAlias(conceptId, alias) {
  const normalized = normalizeConceptAlias(alias);
  if (!normalized) return "skipped";

  const { data: existing } = await supabase
    .from("concept_aliases")
    .select("concept_id")
    .eq("normalized", normalized)
    .maybeSingle();

  if (existing) {
    if (existing.concept_id === conceptId) return "exists";
    console.log(`   ✗ 별칭 충돌: "${alias}" 는 이미 다른 개념에 붙어 있다 (건너뜀)`);
    return "conflict";
  }
  if (dryRun) return "added";

  const { error } = await supabase
    .from("concept_aliases")
    .insert({ concept_id: conceptId, alias, normalized });
  if (error) {
    console.error(`   별칭 등록 실패 (${alias}): ${error.message}`);
    process.exitCode = 1;
    return "skipped";
  }
  return "added";
}
