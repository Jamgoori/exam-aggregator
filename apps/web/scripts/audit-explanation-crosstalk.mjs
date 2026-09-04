// 사용법: npm run audit-explanation-crosstalk
//         npm run audit-explanation-crosstalk -- --window 30 --json out.json
//         npm run audit-explanation-crosstalk -- --no-images        (이미지 대조 생략, 빠름)
//         npm run audit-explanation-crosstalk -- --json out.json --purge
//         npm run audit-explanation-crosstalk -- --restore out.json   (지운 것 되돌리기)
//
// 해설 배치의 **교차 오염**(다른 문제지 문항의 해설이 남의 문항에 저장된 것)을 찾는다.
// 기본은 읽기 전용이고, --purge 를 줄 때만 지운다(백업 필수 — 아래 참고).
//
// 왜 필요한가 (2026-09-04 발견): 사용자가 "약점 진단의 국어 막대에 한국사 개념이
// 섞여 있다"고 신고했다. 실제로 2026 지방직 9급 국어 #16/#18/#19 의 해설이 같은 회차
// 한국사 #16/#18/#19 문항의 해설이었다(문항 이미지는 국어가 맞다 — 크롭 문제가 아니라
// 해설 내용이 남의 것이다). 진단 화면은 문제지의 과목으로 묶으므로, 오염된 해설의
// keyword_title 이 그대로 국어 막대에 한국사 개념으로 올라온다.
//
// 오염의 지문(fingerprint)은 이렇다 — v3 병렬 배치는 청크 3개를 서브에이전트 3개가
// 동시에 쓰는데, 그 청크들이 대개 같은 회차의 이웃 문제지다. 그래서 오염은
//   (1) 같은 문항 번호, (2) 서로 다른 과목의 문제지, (3) 거의 같은 시각에 저장,
//   (4) keyword_title/question_text 가 사실상 동일
// 한 **쌍**으로 남는다. 한쪽은 제자리(진짜), 다른 한쪽은 남의 해설이다.
//
// 다만 (1)~(4)를 만족해도 오염이 아닌 경우가 있다 — 통합본 PDF 분리가 같은 페이지를
// 두 문제지에 넣었거나(크롭 중복), 직류만 다른 같은 문항이 두 문제지에 실제로 실린
// 경우다. 그래서 기본 동작은 두 문항의 대표 이미지를 실제로 받아 해시를 비교한다:
//   - 이미지가 다르다  → 진짜 교차 오염(둘 중 하나는 확실히 틀린 해설)
//   - 이미지가 같다    → 크롭/분리 쪽 문제이지 해설 배치의 잘못이 아니다
//     (docs/agents/split-combined-pdfs.md 로 갈 일이지 여기서 지울 일이 아니다)
//
// --purge 는 **교차 오염으로 분류된 쌍의 양쪽 모두**를 지운다. 어느 쪽이 진짜인지는
// 이미지를 봐야 알 수 있고 그건 배치가 하는 일이라, 둘 다 지워서 큐로 돌려보내는 편이
// 안전하다(next-explanation-chunk.mjs 는 해설이 없는 문항을 다시 집는다 — 제자리였던
// 쪽은 같은 해설이 다시 생길 뿐이다). 지우기 전에 --json 백업 파일에 지울 행 전체를
// 적어 두며, 백업 경로 없이는 지우지 않는다. 그 백업으로 되돌리는 길이 `--restore` 다
// (배치가 다시 만들어 주기를 기다릴 수 없을 때의 비상구 — 이미 해설이 있는 문항은
// 건드리지 않는다). 백업 JSON 은 해설 본문이 들어 있어 **커밋 금지**다(.gitignore 의
// deploy-law-explanations 백업과 같은 이유).
//
// service role 키가 필요하다 (question_explanations 는 service_role 만 읽는다) —
// 소유자 로컬 전용이고, 루틴 환경에서는 돌릴 수 없다.
//
// 조회 주의: 이 테이블은 8만 행이 넘는다. created_at 정렬 + range 로 페이지를 넘기면
// 8초 statement timeout 에 걸린다(실측). 그래서 id 키셋 페이지네이션으로 읽는다.

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const PAGE = 1000;
const UUID_MIN = "00000000-0000-0000-0000-000000000000";
// 판정 기준(실측 표본 716쌍을 눈으로 훑어 맞춘 값).
//
// 핵심은 **keyword_title 이 주된 신호**라는 것이다. question_text 만 보면 안 된다 —
// 해설 배치가 쓰는 문제문에는 "…에 대한 설명으로 옳지 않은 것을 고르는 문제입니다"
// 같은 상용구가 길게 붙어서, 주제가 완전히 남남인 문항끼리도 유사도가 0.8을 넘는다
// (실측: "춘화처리에 대한 설명으로…" ↔ "시설양묘에 대한 설명으로…" = 0.83).
// 반대로 제목은 문항의 주제 요약이라 남남끼리는 0.15를 잘 넘지 않는다.
const TITLE_THRESHOLD = 0.35;
// 문제문이 사실상 글자까지 같은 경우에만, 제목이 조금 갈려도 같은 문항으로 본다
// (제목은 서브에이전트가 자유롭게 쓰므로 같은 문항에도 표기가 크게 갈릴 수 있다).
const TEXT_THRESHOLD = 0.95;
const TEXT_TITLE_FLOOR = 0.2;

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

// 표기 흔들림(공백·따옴표·괄호·대시)을 걷어낸 비교용 문자열.
function normalize(text) {
  return (text ?? "")
    .replace(/[\s　]/g, "")
    .replace(/[·,.'"“”()[\]<>「」『』〈〉\-—–]/g, "");
}

// 두 글자 묶음(bigram)의 Dice 계수. 오염된 해설은 같은 문항을 다시 쓴 것이라 표기가
// 조금씩 갈리므로 완전 일치가 아니라 유사도로 본다("서경(평양)" ↔ "평양(서경)" = 0.67).
function similarity(a, b) {
  // 세 글자 미만은 우연히 겹친다("추론" 같은 제목이 과목마다 있다).
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

// id 키셋 페이지네이션. offset 이 아니라 gt(id) 로 넘겨야 대형 테이블에서 안 죽는다.
async function fetchAllByKeyset(supabase, table, columns) {
  const rows = [];
  let last = UUID_MIN;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .gt("id", last)
      .order("id", { ascending: true })
      .limit(PAGE);
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    if (!data || data.length === 0) break;
    rows.push(...data);
    last = data[data.length - 1].id;
    if (data.length < PAGE) break;
  }
  return rows;
}

async function imageHash(supabase, imagePath) {
  const url = supabase.storage.from("exam-papers").getPublicUrl(imagePath).data.publicUrl;
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash("sha1").update(buf).digest("hex");
}

// --purge 로 지운 행을 백업 JSON 그대로 되돌린다. 이미 해설이 있는 문항(배치가 벌써
// 다시 만든 것)은 건드리지 않는다 — 되살리려던 것이 오염된 옛 해설이었을 수 있다.
// concept_id 가 null 인 행은 그 컬럼을 아예 빼고 넣는다(문서의 upsert 주의사항과 같은
// 이유로, null 을 명시하면 백필로 붙은 개념을 지우는 경로가 생긴다).
async function restore(supabase, backupPath) {
  const parsed = JSON.parse(readFileSync(backupPath, "utf8"));
  const rows = Array.isArray(parsed) ? parsed : (parsed.deletedRowBackup ?? []);
  if (rows.length === 0) {
    console.error(`${backupPath} 에 되돌릴 행이 없습니다.`);
    process.exit(1);
  }
  let restored = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const slice = rows.slice(i, i + 100);
    const { data: existing, error: existingError } = await supabase
      .from("question_explanations")
      .select("question_id")
      .in(
        "question_id",
        slice.map((r) => r.question_id),
      );
    if (existingError) throw new Error(`기존 해설 조회 실패: ${existingError.message}`);
    const taken = new Set((existing ?? []).map((r) => r.question_id));
    const payload = slice
      .filter((r) => !taken.has(r.question_id))
      .map((r) => {
        const row = { ...r };
        if (row.concept_id == null) delete row.concept_id;
        return row;
      });
    skipped += slice.length - payload.length;
    if (payload.length === 0) continue;
    const { error } = await supabase.from("question_explanations").insert(payload);
    if (error) throw new Error(`복원 실패: ${error.message}`);
    restored += payload.length;
  }
  console.log(`복원 ${restored}건 · 이미 해설이 있어 건너뜀 ${skipped}건`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const known = new Set(["window", "json", "no-images", "purge", "restore"]);
  for (const key of Object.keys(args)) {
    if (!known.has(key)) {
      console.error(
        `알 수 없는 플래그: --${key} (지원: --window N, --json 경로, --no-images, --purge, --restore 경로)`,
      );
      process.exit(1);
    }
  }
  const restorePath = typeof args["restore"] === "string" ? args["restore"] : null;
  if (args["restore"] === true) {
    console.error("--restore 는 백업 JSON 경로가 필요합니다.");
    process.exit(1);
  }
  if (restorePath && (args["purge"] || args["json"])) {
    console.error("--restore 는 --purge/--json 과 함께 쓸 수 없습니다.");
    process.exit(1);
  }
  const windowMinutes = Number(args["window"] ?? 30);
  if (!Number.isInteger(windowMinutes) || windowMinutes < 1 || windowMinutes > 1440) {
    console.error("--window 는 1~1440 사이의 정수(분)여야 합니다.");
    process.exit(1);
  }
  const jsonPath = typeof args["json"] === "string" ? args["json"] : null;
  const compareImages = args["no-images"] !== true;
  const purge = args["purge"] === true;
  if (purge && !jsonPath) {
    console.error("--purge 는 --json 백업 경로와 함께 써야 합니다 (지울 행을 먼저 적어 둔다).");
    process.exit(1);
  }
  if (purge && !compareImages) {
    console.error("--purge 는 --no-images 와 함께 쓸 수 없습니다 (크롭 중복까지 지우게 된다).");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  if (restorePath) {
    await restore(supabase, restorePath);
    return;
  }

  console.error("해설·문항·문제지를 읽는 중… (수 분 걸린다)");
  const explanations = await fetchAllByKeyset(
    supabase,
    "question_explanations",
    "id, question_id, keyword_title, question_text, created_at",
  );
  const questions = await fetchAllByKeyset(supabase, "questions", "id, paper_id, question_number");
  const papers = await fetchAllByKeyset(supabase, "exam_papers", "id, title, subject_id");
  const subjects = await fetchAllByKeyset(supabase, "subjects", "id, name");
  console.error(
    `해설 ${explanations.length} · 문항 ${questions.length} · 문제지 ${papers.length}`,
  );

  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const paperById = new Map(papers.map((p) => [p.id, p]));
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const items = [];
  for (const e of explanations) {
    const question = questionById.get(e.question_id);
    if (!question) continue;
    const paper = paperById.get(question.paper_id);
    if (!paper) continue;
    items.push({
      explanationId: e.id,
      questionId: e.question_id,
      keywordTitle: e.keyword_title ?? "",
      questionText: e.question_text ?? "",
      createdAt: e.created_at,
      questionNumber: question.question_number,
      paperId: paper.id,
      paperTitle: paper.title,
      subject: subjectName.get(paper.subject_id) ?? "(과목 미상)",
    });
  }

  // 후보 쌍 만들기. 오염은 "같은 문항 번호 + 다른 과목 + 거의 같은 시각 + 사실상 같은
  // 내용"으로 남으므로, 문항 번호로 먼저 나누고 시간순 슬라이딩 윈도로 좁힌 뒤에만
  // 내용을 비교한다(8만 행 전체를 서로 비교하지 않기 위한 순서다).
  //
  // 내용 비교는 완전 일치가 아니라 유사도다 — 오염된 해설은 같은 문항을 두 사람이 따로
  // 쓴 것이라 표기가 갈린다(실측: "광복 전후 정치 일정의 순서" ↔ "광복 전후 주요 사건의
  // 순서"). 완전 일치만 보면 이런 쌍을 놓친다.
  const windowMs = windowMinutes * 60 * 1000;
  const byNumber = new Map();
  for (const item of items) {
    const list = byNumber.get(item.questionNumber);
    if (list) list.push(item);
    else byNumber.set(item.questionNumber, [item]);
  }

  const pairs = new Map();
  for (const list of byNumber.values()) {
    list.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (new Date(b.createdAt) - new Date(a.createdAt) > windowMs) break;
        if (a.subject === b.subject) continue;
        const titleScore = similarity(normalize(a.keywordTitle), normalize(b.keywordTitle));
        const textScore = similarity(normalize(a.questionText), normalize(b.questionText));
        const sameQuestion =
          titleScore >= TITLE_THRESHOLD ||
          (textScore >= TEXT_THRESHOLD && titleScore >= TEXT_TITLE_FLOOR);
        if (!sameQuestion) continue;
        const key = [a.explanationId, b.explanationId].sort().join("|");
        if (!pairs.has(key)) pairs.set(key, [a, b]);
      }
    }
  }

  console.error(`후보 쌍 ${pairs.size}건 — ${compareImages ? "문항 이미지 대조 중…" : "이미지 대조 생략"}`);

  const crosstalk = [];
  const duplicateCrop = [];
  const unknown = [];
  for (const [a, b] of pairs.values()) {
    if (!compareImages) {
      unknown.push({ a, b });
      continue;
    }
    const { data: images, error } = await supabase
      .from("question_images")
      .select("question_id, image_path")
      .in("question_id", [a.questionId, b.questionId])
      .eq("order_index", 0);
    if (error) throw new Error(`문항 이미지 조회 실패: ${error.message}`);
    const pathA = images?.find((i) => i.question_id === a.questionId)?.image_path;
    const pathB = images?.find((i) => i.question_id === b.questionId)?.image_path;
    if (!pathA || !pathB) {
      unknown.push({ a, b, reason: "대표 이미지 없음" });
      continue;
    }
    const [hashA, hashB] = await Promise.all([
      imageHash(supabase, pathA),
      imageHash(supabase, pathB),
    ]);
    if (!hashA || !hashB) {
      unknown.push({ a, b, reason: "이미지 내려받기 실패" });
      continue;
    }
    if (hashA === hashB) duplicateCrop.push({ a, b });
    else crosstalk.push({ a, b });
  }

  const line = ({ a, b }) =>
    `  ${a.subject} | ${a.paperTitle} #${a.questionNumber}\n` +
    `  ${b.subject} | ${b.paperTitle} #${b.questionNumber}\n` +
    `    "${a.keywordTitle}" (${a.createdAt})`;

  console.log(`\n== 교차 오염 (둘 중 하나는 남의 해설): ${crosstalk.length}쌍`);
  for (const pair of crosstalk) console.log(line(pair));
  if (duplicateCrop.length > 0) {
    console.log(`\n== 이미지가 같은 쌍 (크롭/분리 쪽 문제 — 해설은 건드리지 말 것): ${duplicateCrop.length}쌍`);
    for (const pair of duplicateCrop) console.log(line(pair));
  }
  if (unknown.length > 0) {
    console.log(`\n== 판정 보류: ${unknown.length}쌍`);
    for (const pair of unknown) console.log(line(pair) + (pair.reason ? ` [${pair.reason}]` : ""));
  }

  if (jsonPath) {
    // 백업이자 보고서. --purge 로 지울 행의 전체 내용을 여기 담아 둔다.
    const targetIds = crosstalk.flatMap(({ a, b }) => [a.explanationId, b.explanationId]);
    const backup = [];
    for (let i = 0; i < targetIds.length; i += 100) {
      const slice = targetIds.slice(i, i + 100);
      const { data, error } = await supabase
        .from("question_explanations")
        .select("*")
        .in("id", slice);
      if (error) throw new Error(`백업 조회 실패: ${error.message}`);
      backup.push(...(data ?? []));
    }
    writeFileSync(
      jsonPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          windowMinutes,
          crosstalk,
          duplicateCrop,
          unknown,
          deletedRowBackup: backup,
        },
        null,
        2,
      ),
    );
    console.log(`\n보고서·백업: ${jsonPath} (지울 행 ${backup.length}건 원본 포함)`);

    if (purge) {
      let removed = 0;
      for (let i = 0; i < targetIds.length; i += 100) {
        const slice = targetIds.slice(i, i + 100);
        const { error } = await supabase.from("question_explanations").delete().in("id", slice);
        if (error) throw new Error(`삭제 실패: ${error.message}`);
        removed += slice.length;
      }
      console.log(
        `삭제 ${removed}건 — 다음 해설 배치가 이 문항들을 다시 집는다 (해설 없는 문항을 큐가 자동으로 잡는다).`,
      );
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
