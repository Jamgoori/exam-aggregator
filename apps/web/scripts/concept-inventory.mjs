// 사용법: npm run concept-inventory                     (현황)
//         npm run concept-inventory -- --subject 국어    (한 과목만)
//         npm run concept-inventory -- --draft out.json  (정본 초안 파일로)
//         npm run concept-inventory -- --verify          (매핑 후 건강 검진)
//
// 개념 사전 현황·검증 도구 (읽기 전용, 소유자 전용 — service role 키 필요).
//
// keyword_title 은 해설 배치가 문항마다 자유롭게 쓴 문자열이다. 이걸 정본 개념으로
// 정리해야 약점 진단("대칭키가 약합니다")과 개념별 분포를 만들 수 있다. 정리는
// 사람이 하고, 이 스크립트는 그 판단에 필요한 숫자를 낸다.
//
// 순서:
//   1. (인자 없이) 현황을 본다 — 과목별 문항 수·해설 커버리지·표기 분포
//   2. 그 숫자로 개념 수 목표를 정한다. 감으로 정하지 말 것:
//      사용자가 한 과목에서 틀리는 문항이 20~50개인데 진단이 성립하려면 한 개념에서
//      서너 개는 틀려야 한다. 즉 과목당 개념 20~40개, 단원 5~10개가 현실적인 상한이다.
//   3. --draft 로 초안을 뽑아 사람이 쪼개고 합친다(그룹 키가 "제목의 첫 의미 토큰"
//      이라 "행정행위의 하자"와 "행정행위의 취소"가 한 묶음으로 나온다 — 큐 다양성에는
//      맞지만 진단 축으로는 쪼개야 한다)
//   4. apply-concepts.mjs 로 등록·매핑
//   5. --verify 로 건강 검진. 통과 못 하면 3번으로 돌아간다
//
// 개수만 맞다고 성공으로 판단하지 말 것 — 개념당 문항 3개씩 눈으로 확인해야 한다
// (AGENTS.md 금지선의 크롭 사고와 같은 종류의 함정이다).

import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import {
  buildConceptDrafts,
  buildConceptLookup,
  buildDictionarySubjectIds,
  dictionarySubjectId,
  matchConcept,
  summarizeConceptHealth,
  CONCEPT_MAX_SHARE_BY_KIND,
  CONCEPT_MIN_QUESTIONS,
} from "@gongmoa/core";

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
const subjectFilter = argOf("subject");
const draftPath = argOf("draft");
const verify = process.argv.includes("--verify");

const PAGE = 1000;

// orderBy 는 페이징이 흔들리지 않게 유일한 컬럼 조합이어야 한다. 대부분의 테이블은
// id 하나로 되지만 concept_aliases 는 id 가 없다 — PK 가 (concept_id, normalized) 다.
// (apply-concepts.mjs 의 pageAll 과 같은 규칙. 한쪽만 고치면 --verify 만 다시 죽는다)
async function pageAll(table, select, orderBy = ["id"]) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let query = supabase.from(table).select(select);
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(from, from + PAGE - 1);
    if (error) {
      console.error(`${table} 조회 실패: ${error.message}`);
      process.exit(1);
    }
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const subjects = await pageAll("subjects", "id, name, slug");
const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
// 사전을 빌려 쓰는 과목(한능검 → 한국사). 검진은 빌려준 과목의 사전으로 잰다.
const dictionaryOf = buildDictionarySubjectIds(subjects);
const wantedSubjects = subjectFilter
  ? subjects.filter((s) => s.name === subjectFilter).map((s) => s.id)
  : subjects.map((s) => s.id);

if (wantedSubjects.length === 0) {
  console.error(`과목을 찾을 수 없다: ${subjectFilter}`);
  process.exit(1);
}

// 문항 → 과목. exam_papers 를 거쳐야 한다(questions 에는 과목이 없다).
const papers = await pageAll("exam_papers", "id, subject_id");
const subjectOfPaper = new Map(papers.map((p) => [p.id, p.subject_id]));

const questions = await pageAll("questions", "id, paper_id");
const subjectOfQuestion = new Map();
for (const q of questions) {
  const subjectId = subjectOfPaper.get(q.paper_id);
  if (subjectId) subjectOfQuestion.set(q.id, subjectId);
}

const explanations = await pageAll(
  "question_explanations",
  "id, question_id, keyword_title, concept_id",
);

// 과목별로 접는다. 개념은 언제나 과목에 속한다 — 같은 표기가 과목마다 다른 개념을
// 가리키는 경우가 실제로 있다("관계", "구조").
const perSubject = new Map();
for (const subjectId of wantedSubjects) {
  perSubject.set(subjectId, { questions: 0, explained: 0, titles: new Map(), rows: [] });
}
for (const [questionId, subjectId] of subjectOfQuestion) {
  const bucket = perSubject.get(subjectId);
  if (bucket) bucket.questions++;
  void questionId;
}
for (const e of explanations) {
  const subjectId = subjectOfQuestion.get(e.question_id);
  const bucket = perSubject.get(subjectId);
  if (!bucket) continue;
  bucket.rows.push(e);
  if (!e.keyword_title) continue;
  bucket.explained++;
  bucket.titles.set(e.keyword_title, (bucket.titles.get(e.keyword_title) ?? 0) + 1);
}

if (verify) {
  await runVerify();
} else {
  runInventory();
}

function runInventory() {
  console.log("\n개념 사전 현황\n");
  const drafts = {};

  for (const [subjectId, bucket] of perSubject) {
    if (bucket.questions === 0 && bucket.explained === 0) continue;
    const name = subjectName.get(subjectId) ?? subjectId;
    const titles = [...bucket.titles.entries()].map(([title, count]) => ({ title, count }));
    const once = titles.filter((t) => t.count === 1).length;
    const grouped = buildConceptDrafts(titles);

    console.log(`── ${name}`);
    console.log(
      `   문항 ${bucket.questions} · 해설(개념 있음) ${bucket.explained}` +
        ` (커버리지 ${pct(bucket.explained, bucket.questions)})`,
    );
    console.log(
      `   표기 ${titles.length}종 · 1회만 쓰인 표기 ${once}종 (${pct(once, titles.length)})` +
        ` · 거칠게 묶으면 ${grouped.length}묶음`,
    );
    console.log(`   목표 개념 수: ${targetHint(bucket.explained)}`);
    for (const g of grouped.slice(0, 8)) {
      const aliases = g.aliases.map((a) => `${a.title}(${a.count})`).join(", ");
      console.log(`     · ${g.name} — ${g.count}문항 [${aliases}]`);
    }
    if (grouped.length > 8) console.log(`     ... 외 ${grouped.length - 8}묶음`);
    console.log();

    drafts[name] = grouped;
  }

  if (draftPath) {
    writeFileSync(draftPath, `${JSON.stringify(drafts, null, 2)}\n`, "utf8");
    console.log(`초안을 ${draftPath} 에 썼다.`);
    console.log(
      "이건 확정이 아니라 사람이 쪼개고 합칠 초안이다. 그룹 키가 '제목의 첫 의미\n" +
        "토큰'이라 '행정행위의 하자'와 '행정행위의 취소'가 한 묶음으로 나온다 —\n" +
        "큐 다양성에는 맞지만 진단 축으로는 쪼개야 한다.\n",
    );
  } else {
    console.log("초안 파일이 필요하면: npm run concept-inventory -- --draft concepts.json\n");
  }
}

async function runVerify() {
  // kind 컬럼이 아직 없는 환경(마이그레이션 전)에서는 없이 읽는다.
  let concepts = [];
  try {
    concepts = await pageAll("concepts", "id, subject_id, name, parent_id, merged_into, kind");
  } catch {
    concepts = await pageAll("concepts", "id, subject_id, name, parent_id, merged_into");
  }
  const aliases = await pageAll("concept_aliases", "concept_id, subject_id, alias", [
    "concept_id",
    "normalized",
  ]);
  if (concepts.length === 0) {
    console.log("concepts 테이블이 비어 있다. 먼저 apply-concepts.mjs 로 등록할 것.");
    process.exit(0);
  }

  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const aliasesBySubject = new Map();
  for (const a of aliases) {
    const subjectId = a.subject_id ?? conceptById.get(a.concept_id)?.subject_id;
    if (!subjectId) continue;
    const list = aliasesBySubject.get(subjectId) ?? [];
    list.push({ conceptId: a.concept_id, alias: a.alias });
    aliasesBySubject.set(subjectId, list);
  }

  console.log("\n개념 사전 건강 검진\n");
  let failed = false;

  for (const [subjectId, bucket] of perSubject) {
    const titled = bucket.rows.filter((r) => r.keyword_title);
    if (titled.length === 0) continue;
    const dictId = dictionarySubjectId(subjectId, dictionaryOf);
    const borrowed = dictId !== subjectId;
    const name = subjectName.get(subjectId) ?? subjectId;
    const lookup = buildConceptLookup(aliasesBySubject.get(dictId) ?? []);
    const matches = titled.map((r) => matchConcept(r.keyword_title, lookup));
    const subjectConcepts = concepts.filter((c) => c.subject_id === dictId && !c.merged_into);
    const kindById = new Map(concepts.map((c) => [c.id, c.kind ?? "knowledge"]));
    const health = summarizeConceptHealth(matches, subjectConcepts.length, CONCEPT_MIN_QUESTIONS, (id) =>
      kindById.get(id) === "skill" ? "skill" : "knowledge",
    );

    // 실제 DB 에 붙어 있는 값과 규칙이 말하는 값이 어긋나면 백필이 밀린 것이다.
    const storedMatched = titled.filter((r) => r.concept_id).length;

    console.log(
      `── ${name}` +
        (borrowed ? ` (사전 공유 — ${subjectName.get(dictId) ?? dictId} 의 개념을 쓴다)` : ""),
    );
    console.log(
      `   개념 ${health.concepts}개(단원 ${subjectConcepts.filter((c) => !c.parent_id).length}) ·` +
        ` 문항 ${health.questions}`,
    );
    console.log(
      `   매핑 커버리지 ${pct(health.matched, health.questions)}` +
        ` (별칭 ${health.viaAlias} · 그룹키 ${health.viaKey} · 미매칭 ${health.unmatched})`,
    );
    console.log(`   DB에 실제로 붙은 문항 ${storedMatched} (${pct(storedMatched, health.questions)})`);
    console.log(
      `   얇은 개념(${CONCEPT_MIN_QUESTIONS}문항 미만) ${health.thinConcepts}개` +
        ` (${pct(health.thinConcepts, subjectConcepts.length)})`,
    );
    console.log(`   최대 개념 점유 ${pct(health.maxConceptShare * health.matched, health.matched)}`);

    const problems = [];
    if (health.coverage < 0.95) problems.push("커버리지 95% 미만 — 별칭 보강 필요");
    if (health.thinRatio > 0.2)
      problems.push("얇은 개념이 20% 초과 — 입도가 잘다, 상위로 흡수할 것");
    // 상한은 개념 종류마다 다르다. 독해 기능형(빈칸추론 등)은 시험지에서 원래 큰
    // 비중을 차지하고, 그건 쪼갤 수 있는 축이 아니다.
    if (health.overSizedConcepts.length > 0) {
      const names = health.overSizedConcepts
        .map((o) => {
          const name = conceptById.get(o.conceptId)?.name ?? o.conceptId;
          return `${name} ${(o.share * 100).toFixed(0)}%(${o.kind})`;
        })
        .join(" / ");
      problems.push(
        `종류별 상한 초과 — 지식형 ${CONCEPT_MAX_SHARE_BY_KIND.knowledge * 100}% ·` +
          ` 기능형 ${CONCEPT_MAX_SHARE_BY_KIND.skill * 100}%: ${names}`,
      );
    }
    if (storedMatched < health.matched)
      problems.push("DB 백필이 규칙보다 뒤처져 있다 — apply-concepts 재실행");

    if (problems.length > 0) {
      failed = true;
      for (const p of problems) console.log(`   ✗ ${p}`);
    } else {
      console.log("   ✓ 통과");
    }

    const unmatched = titled
      .map((r, i) => ({ title: r.keyword_title, via: matches[i].via }))
      .filter((m) => m.via === "none")
      .slice(0, 10);
    if (unmatched.length > 0) {
      console.log(`   미매칭 예시: ${unmatched.map((m) => m.title).join(" / ")}`);
    }
    console.log();
  }

  console.log(
    failed
      ? "검진 실패 항목이 있다. 초안을 손보고 apply-concepts 를 다시 돌릴 것.\n"
      : "모든 과목 통과. 그래도 개념당 문항 3개씩은 눈으로 확인할 것.\n",
  );
}

function pct(part, total) {
  return total === 0 ? "0%" : `${((part / total) * 100).toFixed(0)}%`;
}

// 진단이 성립하는 최소 표본에서 역산한 목표치. 사용자가 한 과목에서 틀리는 문항을
// 20~50개로 보고, 개념 하나를 "약하다"고 말하려면 서너 개는 틀려야 한다.
function targetHint(explained) {
  if (explained === 0) return "해설이 없다";
  const upper = Math.max(5, Math.round(explained / CONCEPT_MIN_QUESTIONS / 3));
  return `개념 ${Math.max(5, Math.round(upper / 2))}~${upper}개 · 단원 5~10개`;
}
