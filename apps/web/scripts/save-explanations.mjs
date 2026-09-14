// 사용법: node scripts/save-explanations.mjs <결과파일.json> [결과파일2.json ...]
//
// 결과 파일을 여러 개 주면 전부 이어붙여 한 번에 저장한다 (병렬 서브에이전트가
// 청크별로 따로 쓴 파일을 배치 저장할 때 사용). 저장 로직은 파일 1개일 때와 동일.
// 단, 일부 파일이 없거나/깨졌거나/빈 배열이어도 전체를 중단하지 않는다 — 그 파일만
// 건너뛰고(stdout의 skipped_files로 보고) 나머지 정상 파일은 저장한다. 병렬 생성에서
// 서브에이전트 하나가 실패했다고 나머지의 완성된 해설까지 버리면 안 되기 때문.
// 저장할 항목이 하나도 없을 때만 exit 1. 같은 question_id가 여러 파일에 있으면
// 마지막 항목만 저장한다 (재시도 결과 파일이 뒤에 오는 관례; deduplicated로 보고).
//
// next-explanation-chunk.mjs가 내려준 청크에 대해 생성한 해설을 저장한다.
// 입력 JSON 형식 (배열):
// [
//   {
//     "question_id": "uuid",
//     "keyword_title": "기능 점수(Function Point) 산정 방법",
//     "concept": "소프트웨어 규모 산정",   // 청크의 concepts 목록에서 고른 이름 (없으면 생략)
//     "keyword_explanation": "핵심 개념 설명 문단...",
//     "question_text": "문제 발문 한 줄 재구성",
//     "correct_choice_number": 4,
//     "correct_choice_summary": "정답 선지 한 줄 요약",
//     "choice_explanations": [
//       // 법령 선지의 verdict_label/explanation은 현행법 기준으로 쓴다. current_status("유효"|"개정됨"|"확인불가")와,
//       // 개정됨일 때 출제 당시 기준 한 줄 original_note가 더 붙는다.
//       { "number": 1, "verdict_label": "맞는 설명", "explanation": "현행법 기준 근거...", "current_status": "유효" },
//       { "number": 2, "verdict_label": "틀린 설명", "explanation": "현행법 기준으로 왜 틀렸는지...", "current_status": "개정됨", "original_note": "출제 당시에는 11%여서 맞는 설명이었습니다(현행 25.3%)." },
//       ...
//     ],
//     // 아래 3개는 법령 문항에서만 채운다(비법령 문항이면 전부 생략/null).
//     "current_answer_status": "동일",   // "동일" | "정답변경" | "성립불가"
//     "current_answer_note": null,        // 정답변경/성립불가 사유 한두 줄
//     "law_basis_date": "2026-07",        // 참조한 "현행"의 기준 시점
//     "model_version": "claude-opus-4-8"
//   },
//   ...
// ]
//
// correct_choice_number를 verify_question_answer()로 실제 정답표와 대조한 뒤
// question_explanations에 upsert한다(해설은 정답을 보여주는 게 목적이라
// correct_choice_number를 그대로 저장·노출한다 — CBT 채점용 paper_answers와는
// 다른 원칙). 대조에 실패한(불일치) 항목도 저장은 하되 verified=false로 남기고,
// stdout에 mismatched로 모아 보고한다 — RLS가 verified=false 행을 일반 사용자에게
// 숨기므로, 호출한 쪽(에이전트)이 그 문항만 재검토/재생성할 때까지는 비공개로 남는다.
//
// concept: next-explanation-chunk가 청크에 실어 보낸 그 과목 정본 개념 목록에서 고른
// 이름이다. 여기서 concept_id로 바꿔 단다(약점 진단이 쓸 축). 목록에 없어서
// "?새 이름" 형태로 제안한 것과, 목록에 있다고 썼는데 안 붙는 것은 나눠서 보고한다 —
// 앞은 사람이 목록에 넣을지 판단할 거리이고, 뒤는 배치가 이름을 잘못 베낀 것이다.
// 어느 쪽도 "기타"로 뭉치지 않는다(docs/agents/concept-dictionary.md).

import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

// packages/core/src/concept-dictionary.ts 의 normalizeConceptAlias 와 같은 규칙이다.
//
// 사본을 두는 이유: 이 스크립트는 배치 루틴 환경에서 plain node로 돌고,
// @gongmoa/core 는 빌드 산출물이 없는 TypeScript 소스라 import 할 수 없다.
// 한쪽만 고치면 배치가 붙이는 개념과 apply-concepts 백필이 붙이는 개념이 조용히
// 달라진다 — srs.ts 사본 규칙과 같이, 반드시 둘을 함께 고칠 것.
function normalizeConceptAlias(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[\s·,、/()[\]{}<>"'“”‘’:;~\-–—.]/g, "");
}

// packages/core/src/concept-dictionary.ts 의 CONCEPT_DICTIONARY_SOURCE_BY_SLUG 사본이다
// (사본을 두는 이유는 위와 같다).
//
// 과목 행이 갈렸다고 개념까지 갈리는 건 아니다. 한능검은 문항 수·선지 수가 달라 문제지
// 목록을 공무원 한국사와 섞을 수 없어 전용 과목 행을 쓰지만, 묻는 내용은 같은 한국사
// 통사다. 그래서 사전을 복제하지 않고 빌려 쓴다 — 복제하면 같은 개념이 id 둘로 갈려
// 진단 표본이 반씩 쪼개진다(docs/agents/concept-dictionary.md).
const CONCEPT_DICTIONARY_SOURCE_BY_SLUG = {
  // 한국사능력검정시험 → 공무원 한국사
  "korean-history-exam": "korean-history",
};

// "빌린 과목 id → 빌려준 과목 id". 조회가 실패해도 던지지 않는다 — 공유가 안 걸리면
// 그 과목만 예전처럼 "사전 없음"으로 보고될 뿐이고, 해설 저장을 막는 건 손해가 크다.
async function loadDictionarySubjectIds(supabase) {
  const slugs = [
    ...new Set([
      ...Object.keys(CONCEPT_DICTIONARY_SOURCE_BY_SLUG),
      ...Object.values(CONCEPT_DICTIONARY_SOURCE_BY_SLUG),
    ]),
  ];
  const { data, error } = await supabase.from("subjects").select("id, slug").in("slug", slugs);
  if (error) {
    console.error(`사전 공유 과목 조회 실패 — 공유 없이 진행: ${error.message}`);
    return new Map();
  }
  const idBySlug = new Map((data ?? []).filter((r) => r?.slug).map((r) => [r.slug, r.id]));
  const map = new Map();
  for (const [borrower, source] of Object.entries(CONCEPT_DICTIONARY_SOURCE_BY_SLUG)) {
    const borrowerId = idBySlug.get(borrower);
    const sourceId = idBySlug.get(source);
    if (borrowerId && sourceId && borrowerId !== sourceId) map.set(borrowerId, sourceId);
  }
  return map;
}

// PostgREST의 .in() 은 URL 길이 제한이 있어 나눠 던진다.
async function selectIn(supabase, table, columns, column, values) {
  const rows = [];
  for (let i = 0; i < values.length; i += 200) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .in(column, values.slice(i, i + 200));
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
  }
  return rows;
}

// ── 청크 간 교차 오염 차단 ─────────────────────────────────────────────────
//
// v3 병렬 배치(청크 3개 → 서브에이전트 3개 → 파일 3개 → 이 스크립트 한 번)에서
// 서브에이전트가 남의 청크 문항 이미지를 읽고 쓴 해설이 제 문항 id 로 저장되는 사고가
// 있었다(2026-09-04 전수 조사: 963행, docs/agents/explanation-batch-routines.md).
// 지문은 늘 같았다 — **같은 문항 번호**의 서로 다른 문제지 문항 둘이 같은 배치에서
// 사실상 같은 제목/발문의 해설을 받는다. 둘 중 하나는 확실히 남의 해설인데 어느 쪽인지는
// 여기서 알 수 없으니, 그 쌍은 **둘 다 저장하지 않고** 보고만 한다. 안 저장된 문항은
// 해설이 없는 채로 남아 다음 배치가 다시 집는다(다른 청크 조합에서 다시 만들면 대개
// 정상으로 나온다).
//
// 다만 같은 문항이 두 문제지에 실린 경우(통합본 분리 중복, 또는 같은 시험이 두 과목명
// 으로 올라간 쌍둥이 문제지 — 형법 ↔ 형법총론, 회계학 ↔ 회계원리)는 해설이 같은 것이
// 정상이다. 그걸 여기서 막으면 그 문항들은 배치가 돌 때마다 만들고 버리기를 반복한다.
// 그래서 의심 쌍은 대표 이미지를 실제로 받아 비교하고, **같은 문항 그림이면 통과**시킨다
// (audit-explanation-crosstalk.mjs 와 같은 판정 — 바이트 동일 또는 지각 해시 근접).
function normalizeForCompare(text) {
  return (text ?? "")
    .replace(/[\s　]/g, "")
    .replace(/[·,.'"“”()[\]<>「」『』〈〉\-—–]/g, "");
}

// 두 글자 묶음(bigram) Dice 계수. 같은 문항을 두 에이전트가 따로 쓰면 제목 표기가
// 갈리므로("광복 전후 정치 일정의 순서" ↔ "광복 전후 주요 사건의 순서") 완전 일치가
// 아니라 유사도로 본다. 임계값은 감사 스크립트와 같은 0.35 — 남남인 제목은 0.15 를
// 잘 넘지 않는다(실측).
function titleSimilarity(a, b) {
  if (a.length < 3 || b.length < 3) return 0;
  if (a === b) return 1;
  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      out.set(g, (out.get(g) ?? 0) + 1);
    }
    return out;
  };
  const ga = bigrams(a);
  const gb = bigrams(b);
  let shared = 0;
  for (const [g, n] of ga) shared += Math.min(n, gb.get(g) ?? 0);
  return (2 * shared) / (a.length - 1 + b.length - 1);
}
const CROSSTALK_TITLE_THRESHOLD = 0.35;

// audit-explanation-crosstalk.mjs 와 같은 판정이다 — 한쪽만 고치지 말 것.
// 문항 이미지가 "같은 문항"인지 판정한다. 바이트가 같으면(sha1) 당연히 같고, 다르더라도
// **지각 해시(dHash, 16×16 → 256비트)의 해밍 거리가 가까우면 같은 문항**으로 본다.
// 왜 필요한가(2026-09-05 실측): 같은 시험이 두 과목명으로 따로 올라간 쌍둥이 문제지
// (2013·2016 국가직 9급 회계학 ↔ 회계원리, 2021·2023 형사소송법 ↔ 형사소송법개론,
// 2020 형법 ↔ 형법총론)는 같은 문항이 **다른 PDF에서 따로 크롭**돼 바이트는 다르지만
// 그림은 같다. sha1 만 보면 이걸 교차 오염으로 오판해 — 감사는 멀쩡한 해설을 지우고,
// 저장 차단막은 배치가 돌 때마다 만들고 버리기를 반복한다.
//   실측 거리: 쌍둥이 21·27·31·35·43·53·67 / 진짜 오염(다른 문항) 102·110·111·123
// 그래서 80 을 경계로 둔다. sharp 가 없는 환경이면 sha1 비교로만 떨어진다.
const IMAGE_DHASH_MAX_DISTANCE = 80;

async function imageSignature(supabase, imagePath) {
  const url = supabase.storage.from("exam-papers").getPublicUrl(imagePath).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const sha1 = createHash("sha1").update(buf).digest("hex");
  let dhash = null;
  try {
    const sharp = (await import("sharp")).default;
    const { data } = await sharp(buf)
      .grayscale()
      .resize(17, 16, { fit: "fill" })
      .raw()
      .toBuffer({ resolveWithObject: true });
    dhash = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) dhash.push(data[y * 17 + x] < data[y * 17 + x + 1] ? 1 : 0);
    }
  } catch {
    dhash = null;
  }
  return { sha1, dhash };
}

function sameQuestionImage(a, b) {
  if (!a || !b) return false;
  if (a.sha1 === b.sha1) return true;
  if (!a.dhash || !b.dhash) return false;
  let distance = 0;
  for (let i = 0; i < a.dhash.length; i++) if (a.dhash[i] !== b.dhash[i]) distance++;
  return distance <= IMAGE_DHASH_MAX_DISTANCE;
}

// 저장 직전에 부른다. 돌려주는 값은 { blocked: Set<question_id>, pairs: [...] }.
// 조회가 실패하면 막지 않고 저장을 계속한다 — 이 장치는 안전망이지 저장의 전제조건이
// 아니다(해설 본문은 이 세션에서만 만들 수 있다).
async function detectCrosstalk(supabase, items) {
  const blocked = new Set();
  const pairs = [];
  if (items.length < 2) return { blocked, pairs };

  const questionRows = await selectIn(
    supabase,
    "questions",
    "id, paper_id, question_number",
    "id",
    items.map((i) => i.question_id),
  );
  const questionById = new Map(questionRows.map((q) => [q.id, q]));

  const byNumber = new Map();
  for (const item of items) {
    const q = questionById.get(item.question_id);
    if (!q) continue;
    const list = byNumber.get(q.question_number);
    if (list) list.push({ item, q });
    else byNumber.set(q.question_number, [{ item, q }]);
  }

  const suspects = [];
  for (const list of byNumber.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.q.paper_id === b.q.paper_id) continue;
        const titleScore = titleSimilarity(
          normalizeForCompare(a.item.keyword_title),
          normalizeForCompare(b.item.keyword_title),
        );
        const sameText =
          normalizeForCompare(a.item.question_text).length >= 10 &&
          normalizeForCompare(a.item.question_text) === normalizeForCompare(b.item.question_text);
        if (titleScore >= CROSSTALK_TITLE_THRESHOLD || (sameText && titleScore >= 0.2)) {
          suspects.push([a, b]);
        }
      }
    }
  }
  if (suspects.length === 0) return { blocked, pairs };

  const imageRows = await selectIn(
    supabase,
    "question_images",
    "question_id, image_path, order_index",
    "question_id",
    suspects.flatMap(([a, b]) => [a.q.id, b.q.id]),
  );
  const coverImage = new Map();
  for (const r of imageRows) {
    if (r.order_index === 0) coverImage.set(r.question_id, r.image_path);
  }

  for (const [a, b] of suspects) {
    const pathA = coverImage.get(a.q.id);
    const pathB = coverImage.get(b.q.id);
    let sameImage = false;
    if (pathA && pathB) {
      const [sigA, sigB] = await Promise.all([
        imageSignature(supabase, pathA),
        imageSignature(supabase, pathB),
      ]);
      sameImage = sameQuestionImage(sigA, sigB);
    }
    const record = {
      question_number: a.q.question_number,
      a: { question_id: a.q.id, paper_id: a.q.paper_id, keyword_title: a.item.keyword_title },
      b: { question_id: b.q.id, paper_id: b.q.paper_id, keyword_title: b.item.keyword_title },
      same_image: sameImage,
    };
    pairs.push(record);
    if (!sameImage) {
      blocked.add(a.q.id);
      blocked.add(b.q.id);
    }
  }
  return { blocked, pairs };
}

// concept 이름 → concept_id. 문항이 속한 과목 안에서만 찾는다 — 별칭은 과목 안에서만
// 유일하고, 국어 "내용 일치"와 영어 "내용 일치"는 서로 다른 개념이다.
//
// 실패해도 저장은 계속한다. 개념은 나중에 백필로 붙일 수 있지만 해설 본문은 이
// 세션에서만 만들 수 있다.
async function resolveConcepts(supabase, items) {
  const report = { attached: 0, proposed: [], unmatched: [], subjects_without_dictionary: [] };
  const byQuestion = new Map();

  const wanted = items.filter((i) => typeof i.concept === "string" && i.concept.trim());
  if (wanted.length === 0) return { byQuestion, report };

  const questionRows = await selectIn(
    supabase,
    "questions",
    "id, paper_id",
    "id",
    wanted.map((i) => i.question_id),
  );
  const paperIds = [...new Set(questionRows.map((q) => q.paper_id))];
  const paperRows = await selectIn(supabase, "exam_papers", "id, subject_id", "id", paperIds);
  const subjectOfPaper = new Map(paperRows.map((p) => [p.id, p.subject_id]));
  const subjectOfQuestion = new Map(
    questionRows.map((q) => [q.id, subjectOfPaper.get(q.paper_id) ?? null]),
  );

  // 사전을 빌려 쓰는 과목(한능검 → 한국사)은 빌려준 과목의 별칭을 본다.
  const dictionaryOf = await loadDictionarySubjectIds(supabase);
  const dictionaryIdOf = (subjectId) => dictionaryOf.get(subjectId) ?? subjectId;
  const subjectIds = [
    ...new Set([...subjectOfQuestion.values()].filter(Boolean).map(dictionaryIdOf)),
  ];
  const aliasRows = await selectIn(
    supabase,
    "concept_aliases",
    "concept_id, subject_id, normalized",
    "subject_id",
    subjectIds,
  );
  const conceptByAlias = new Map();
  const subjectsWithDictionary = new Set();
  for (const a of aliasRows) {
    conceptByAlias.set(`${a.subject_id}\u0000${a.normalized}`, a.concept_id);
    subjectsWithDictionary.add(a.subject_id);
  }

  // 사전이 아직 없는 과목은 문항마다 미매칭으로 쏟아지는 게 정상이다. 그건 배치가
  // 틀린 게 아니라 사람이 아직 목록을 안 만든 것이라 따로 센다.
  const noDictionary = new Map();
  const proposed = new Map();
  const unmatched = new Map();

  for (const item of wanted) {
    const subjectId = subjectOfQuestion.get(item.question_id) ?? null;
    const raw = item.concept.trim();
    // "?" 접두는 "목록에 없어서 새로 제안한다"는 배치 쪽 표시다.
    const isProposal = raw.startsWith("?");
    const name = raw.replace(/^\?+\s*/, "").trim();
    if (!name) continue;

    const conceptId = subjectId
      ? conceptByAlias.get(`${dictionaryIdOf(subjectId)}\u0000${normalizeConceptAlias(name)}`)
      : undefined;

    // "?"를 붙였어도 실제로 목록에 있으면 붙인다 — 이름이 맞으면 진단 분포는
    // 틀어지지 않는다. 접두는 배치의 판단일 뿐 사전보다 우선하지 않는다.
    if (conceptId) {
      byQuestion.set(item.question_id, conceptId);
      report.attached++;
      continue;
    }

    const bucket = isProposal
      ? proposed
      : subjectId && !subjectsWithDictionary.has(dictionaryIdOf(subjectId))
        ? noDictionary
        : unmatched;
    const key = `${subjectId ?? "?"}\u0000${name}`;
    const entry = bucket.get(key) ?? { concept: name, subject_id: subjectId, count: 0 };
    entry.count++;
    entry.example_question_id ??= item.question_id;
    bucket.set(key, entry);
  }

  const toList = (m) => [...m.values()].sort((a, b) => b.count - a.count);
  report.proposed = toList(proposed);
  report.unmatched = toList(unmatched);
  report.subjects_without_dictionary = toList(noDictionary);
  return { byQuestion, report };
}

async function main() {
  const inputPaths = process.argv.slice(2);
  if (inputPaths.length === 0) {
    console.error("사용법: node scripts/save-explanations.mjs <결과파일.json> [결과파일2.json ...]");
    process.exit(1);
  }

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

  const items = [];
  const skippedFiles = [];
  for (const inputPath of inputPaths) {
    let parsed;
    try {
      parsed = JSON.parse(await readFile(inputPath, "utf-8"));
    } catch (e) {
      skippedFiles.push({ file: inputPath, reason: e.message });
      continue;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      skippedFiles.push({ file: inputPath, reason: "빈 배열이거나 배열이 아닌 JSON" });
      continue;
    }
    items.push(...parsed);
  }
  for (const s of skippedFiles) {
    console.error(`입력 파일 건너뜀: ${s.file} — ${s.reason}`);
  }
  if (items.length === 0) {
    console.error("저장할 항목이 없습니다 (모든 입력 파일이 무효).");
    process.exit(1);
  }

  // 같은 question_id가 여러 입력에 있으면 마지막 것만 저장 (재시도 파일이 뒤에 오는 관례)
  const byId = new Map();
  for (const item of items) byId.set(item.question_id, item);
  const deduplicated = items.length - byId.size;
  const uniqueItems = [...byId.values()];

  const supabase = createClient(supabaseUrl, publishableKey);
  const { error: authError } = await supabase.auth.signInWithPassword({
    email: botEmail,
    password: botPassword,
  });
  if (authError) {
    console.error(`봇 계정 로그인 실패: ${authError.message}`);
    process.exit(1);
  }

  let conceptByQuestion = new Map();
  let conceptReport = null;
  try {
    const resolved = await resolveConcepts(supabase, uniqueItems);
    conceptByQuestion = resolved.byQuestion;
    conceptReport = resolved.report;
  } catch (e) {
    console.error(`개념 매칭 실패 — 개념 없이 저장을 계속한다: ${e?.message ?? e}`);
  }

  // 교차 오염 의심 쌍은 둘 다 저장하지 않는다. 조회 실패는 막지 않고 넘어간다.
  let crosstalk = { blocked: new Set(), pairs: [] };
  try {
    crosstalk = await detectCrosstalk(supabase, uniqueItems);
  } catch (e) {
    console.error(`교차 오염 검사 실패 — 검사 없이 저장을 계속한다: ${e?.message ?? e}`);
  }
  for (const pair of crosstalk.pairs) {
    if (pair.same_image) continue;
    console.error(
      `교차 오염 의심 — 저장 안 함: #${pair.question_number} "${pair.a.keyword_title}" (${pair.a.question_id}) ↔ "${pair.b.keyword_title}" (${pair.b.question_id})`,
    );
  }

  const mismatched = [];
  const saved = [];

  for (const item of uniqueItems) {
    if (crosstalk.blocked.has(item.question_id)) continue;
    const { data: verified, error: verifyError } = await supabase.rpc("verify_question_answer", {
      target_question_id: item.question_id,
      proposed_answer: item.correct_choice_number,
    });
    if (verifyError) {
      console.error(`정답 대조 실패 (${item.question_id}): ${verifyError.message}`);
      continue;
    }

    // concept_id는 붙었을 때만 payload에 넣는다. null로 넣으면 upsert의 SET 목록에
    // 들어가서, 이미 백필로 붙어 있던 개념을 덮어 지운다(재저장·재생성 때).
    const conceptId = conceptByQuestion.get(item.question_id) ?? null;
    const conceptField = conceptId ? { concept_id: conceptId } : {};

    const { error: upsertError } = await supabase.from("question_explanations").upsert(
      {
        question_id: item.question_id,
        keyword_title: item.keyword_title,
        ...conceptField,
        keyword_explanation: item.keyword_explanation,
        question_text: item.question_text,
        correct_choice_number: item.correct_choice_number,
        correct_choice_summary: item.correct_choice_summary,
        choice_explanations: item.choice_explanations,
        law_amendment_note: item.law_amendment_note ?? null,
        current_answer_status: item.current_answer_status ?? null,
        current_answer_note: item.current_answer_note ?? null,
        law_basis_date: item.law_basis_date ?? null,
        verified: verified === true,
        model_version: item.model_version,
      },
      { onConflict: "question_id" },
    );
    if (upsertError) {
      console.error(`저장 실패 (${item.question_id}): ${upsertError.message}`);
      continue;
    }

    saved.push(item.question_id);
    if (verified !== true) {
      mismatched.push({ question_id: item.question_id, correct_choice_number: item.correct_choice_number });
    }
  }

  console.log(
    JSON.stringify(
      {
        saved_count: saved.length,
        mismatched,
        skipped_files: skippedFiles,
        deduplicated,
        // 이미지가 다른데 해설이 같은 쌍 — 둘 다 저장하지 않았다. 다음 배치가 다시 집는다.
        suspected_crosstalk: crosstalk.pairs.filter((p) => !p.same_image),
        concepts: conceptReport,
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
