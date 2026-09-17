// 사용법: node --env-file=.env.local scripts/triage-question-reports.mjs
//         node --env-file=.env.local scripts/triage-question-reports.mjs --all
//         node --env-file=.env.local scripts/triage-question-reports.mjs --report-id <uuid>
//
// 사용자가 낸 **문항 오류 신고**(`question_reports`)를 한 건씩 정답표·해설과 대조해
// "고칠 것인지 오신고인지"를 판정 재료째로 뽑아 준다. 소유자 전용(service role 키),
// 읽기 전용 — 신고 상태도 바꾸지 않는다(해결 처리는 관리자 화면에서).
//
// 왜 필요한가 (2026-09-17): "2026 국회직 8급 행정법총론 18번 답이 1번이다" 신고가
// 들어왔다. DB 도 해설도 보면 판정이 안 선다 — 해설봇은 실제로 1번이라고 써놨고
// DB 는 5번이었다. 판정을 낸 건 **책형**이었다: 그 정답표는 가형·다형 두 벌이고,
// 문제지 PDF 머리글에 "책형 가", DB 25문항이 가형과 25/25 일치, 가형 문18 = 5.
// 즉 정답은 옳고 **해설이 틀린** 건이었다. 그래서 이 도구는 신고 한 건마다
//
//   1. 덮는 정답표의 **모든 후보 열**(책형 분기 포함)에서 그 문항 값을 뽑고,
//      대상 문항을 뺀 나머지 셀 일치율을 같이 보여 준다(= 어느 책형 열인지의 근거)
//   2. 문제지 PDF 첫 쪽에서 책형 표기를 찾아 준다
//   3. AI 해설의 답·verified·발문
//   4. 해설 오류 신고면, 같은 회차 같은 문항번호 해설을 과목별로 한 줄씩 나열한다 —
//      남의 과목 해설이 앉았는지 눈으로 바로 보라는 것이다 (실측: 2022 국가직 9급
//      사회복지학개론 17번에 기계설계 17번 해설이 들어가 있었다. 정답 번호가 우연히
//      둘 다 2라서 verified 게이트를 그대로 통과했다). 청소는
//      audit-explanation-crosstalk.mjs — 다만 그 쌍은 제목 유사도 0.07, 발문 0.25 라
//      그 도구의 임계값(제목 0.35)에도 안 걸린다. 자동 판정을 믿지 말 것.
//
// 판정 원칙은 바꾸지 말 것: **공식 정답표가 정본**이다. 해설봇이 다른 답을 내도
// 그것만으로 DB 를 고치지 않는다 — 고치는 건 정답표(텍스트 레이어 + 렌더 이미지)가
// DB 반대편에 섰을 때뿐이고, 절차는 docs/agents/answer-keys-tracks.md 의 게이트 7개.

import { createClient } from "@supabase/supabase-js";
import { loadPdfjs, parseAnswerPdf, normalizeSubjectName } from "./lib/answer-grid-parser.mjs";

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

const REASON_LABEL = {
  wrong_answer: "정답 오류",
  wrong_explanation: "해설 오류",
  image_issue: "이미지 오류",
  other: "기타",
};

// DB 과목명 → 정답표·문제지에 인쇄되는 다른 표기. packages/core/src/subject-label.ts 의
// SUBJECT_NAME_BY_EXAM_TYPE 과 같은 내용이다(그 파일은 TS 라 여기서 못 읽는다 —
// 거기 한 줄을 넣으면 여기도 같이 넣을 것). 실측: 2026 국회직 8급 정답표 머리글은
// "행정법"인데 DB 과목명은 "행정법총론"이라, 이게 없으면 열을 아예 못 찾는다.
const SUBJECT_ALIASES = {
  행정법총론: ["행정법"],
  행정학개론: ["행정학"],
};

// 책형 글자는 아는 것만 받는다. "행 정 법 책형 가" 같은 머리글에서 앞 글자까지
// 주워 "법책형"으로 읽는 걸 막는다.
const FORM_LETTER = "가|나|다|라|마|A|B|C|D|①|②|③|④|⑤";
const FORM_RE = new RegExp(`책\\s*형\\s*[:：]?\\s*(${FORM_LETTER})|(${FORM_LETTER})\\s*책\\s*형`, "g");

function readFormMarks(text) {
  const out = new Set();
  for (const m of text.matchAll(FORM_RE)) out.add(`${m[1] ?? m[2]}책형`);
  return [...out];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const sb = createClient(supabaseUrl, serviceRoleKey);
  const pdfjs = await loadPdfjs();

  const { data: subjects } = await sb.from("subjects").select("id,name");
  const subjectName = new Map((subjects ?? []).map((s) => [s.id, s.name]));
  const { data: keys } = await sb.from("answer_keys").select("*");

  let query = sb.from("question_reports").select("*").order("created_at", { ascending: false });
  if (args["report-id"]) query = query.eq("id", args["report-id"]);
  else if (!args["all"]) query = query.eq("status", "open");
  const { data: reports, error } = await query;
  if (error) throw new Error(`question_reports 조회 실패: ${error.message}`);
  console.log(`신고 ${reports.length}건\n`);

  for (const r of reports) {
    const { data: p } = await sb.from("exam_papers").select("*").eq("id", r.paper_id).single();
    const subject = subjectName.get(p.subject_id) ?? "?";
    const { data: pa } = await sb
      .from("paper_answers")
      .select("answers,voided_questions")
      .eq("paper_id", r.paper_id)
      .maybeSingle();
    const dbAnswer = pa?.answers?.[r.question_number - 1] ?? null;
    const voided = (pa?.voided_questions ?? []).includes(r.question_number);

    console.log("=".repeat(78));
    console.log(`[${REASON_LABEL[r.reason] ?? r.reason} · ${r.context} · ${r.status}] ${p.title} ${r.question_number}번`);
    console.log(`  신고: ${r.message ?? "(내용 없음)"}   (${r.created_at?.slice(0, 16)})`);
    console.log(`  report_id ${r.id}`);
    console.log(`  DB 정답: ${dbAnswer ?? "(정답 미등록)"}${voided ? "  ※ voided(무조건 정답 처리)" : ""}`);

    // --- 1. 정답표의 모든 후보 열 (책형 분기 포함) ---
    const ownKeyTracks = new Set(
      keys
        .filter((k) => k.track && k.exam_type_id === p.exam_type_id && k.year === p.year && k.round === p.round && k.level === p.level)
        .map((k) => k.track),
    );
    const covering = keys.filter(
      (k) =>
        k.exam_type_id === p.exam_type_id &&
        k.year === p.year &&
        k.round === p.round &&
        (k.level ? p.level === k.level : p.level === null) &&
        (k.track ? p.track === k.track : !ownKeyTracks.has(p.track)),
    );
    if (covering.length === 0) console.log("  정답표: 이 문제지를 덮는 정답표가 없다");
    const targets = [subject, ...(SUBJECT_ALIASES[subject] ?? [])].map(normalizeSubjectName);
    for (const k of covering) {
      const { data: blob, error: dlError } = await sb.storage.from("exam-papers").download(k.file_path);
      if (dlError || !blob) {
        console.log(`  정답표 [${k.file_name}] 다운로드 실패: ${dlError?.message}`);
        continue;
      }
      let parsed;
      try {
        parsed = await parseAnswerPdf(pdfjs, await blob.arrayBuffer());
      } catch (e) {
        console.log(`  정답표 [${k.file_name}] 파싱 실패: ${e?.message ?? e}`);
        continue;
      }
      if (!parsed.hasText) {
        console.log(`  정답표 [${k.file_name}] 스캔본(텍스트 레이어 없음) — 렌더해서 눈으로 볼 것`);
        continue;
      }
      // 과목명이 걸리는 열을 길이 무관으로 전부 모은다. 표제가 머리글에 얹혀
      // "…정답표가형행정법" 처럼 뭉개지는 판형이 있어 endsWith 가 아니라 includes 다.
      const cands = [];
      for (const pg of parsed.pages)
        for (const tb of pg.tables)
          for (const c of tb.columns) {
            if (!targets.some((t) => c.header.includes(t) || (c.header.length >= 2 && t.includes(c.header)))) continue;
            const map = new Map();
            tb.rowNumbers.forEach((qn, i) => {
              if (c.values[i] != null) map.set(qn, c.values[i]);
            });
            cands.push({ page: pg.pageNumber, header: c.header, map });
          }
      console.log(`  정답표 [${k.file_name}] '${subject}' 후보 열 ${cands.length}개${cands.length > 1 ? "  ※ 책형 분기 — 아래 일치율로 고를 것" : ""}`);
      for (const c of cands) {
        let hit = 0;
        let n = 0;
        for (let i = 1; i <= (pa?.answers?.length ?? 0); i++) {
          if (i === r.question_number || !c.map.has(i)) continue;
          n++;
          if (c.map.get(i) === pa.answers[i - 1]) hit++;
        }
        const verdict = n > 0 && hit === n ? " ← 이 열이 이 문제지 것" : "";
        console.log(`     p${c.page} [${c.header.slice(-22)}] 문${r.question_number} = ${c.map.get(r.question_number) ?? "-"}   나머지 ${hit}/${n} 일치${verdict}`);
      }
    }

    // --- 2. 문제지 PDF 의 책형 표기 ---
    let paperText = "";
    try {
      const { data: pblob } = await sb.storage.from("exam-papers").download(p.file_path);
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await pblob.arrayBuffer()), useSystemFonts: true, isEvalSupported: false }).promise;
      const tc = await doc.getPage(1).then((pg) => pg.getTextContent());
      paperText = tc.items.map((i) => i.str).join(" ").replace(/\s+/g, " ");
    } catch {
      /* 문제지가 스캔본이면 텍스트가 없다 — 책형은 눈으로 */
    }
    const forms = readFormMarks(paperText);
    console.log(`  문제지 책형 표기: ${forms.length ? forms.join(", ") : paperText ? "없음" : "(텍스트 레이어 없음)"}`);

    // --- 3. AI 해설 증인 ---
    const { data: q } = await sb
      .from("questions")
      .select("id")
      .eq("paper_id", r.paper_id)
      .eq("question_number", r.question_number)
      .maybeSingle();
    let expl = null;
    if (q) {
      const { data: e } = await sb
        .from("question_explanations")
        .select("question_id,question_text,keyword_title,correct_choice_number,verified")
        .eq("question_id", q.id)
        .maybeSingle();
      expl = e;
    }
    if (!expl) console.log("  해설: 없음");
    else {
      console.log(`  해설: 답=${expl.correct_choice_number} verified=${expl.verified}  [${expl.keyword_title ?? ""}]`);
      console.log(`     발문: ${(expl.question_text ?? "").slice(0, 120).replace(/\n/g, " ")}`);
    }

    // --- 4. 해설이 이 과목 문항의 것인지 (교차오염) ---
    // 자동 판정은 일부러 하지 않는다. 실측(2022 국가직 9급 사회복지학개론 17번에
    // 기계설계 17번 해설이 앉은 건)에서 **제목 유사도 0.07 / 발문 유사도 0.25** 라,
    // audit-explanation-crosstalk.mjs 의 임계값(제목 0.35)으로도 안 걸린다. 서브에이전트가
    // 제목·발문을 각자 다시 쓰기 때문이다. 그래서 여기서는 같은 회차 같은 번호 해설을
    // 나열해 사람이 바로 눈으로 볼 수 있게만 한다 — 남의 과목 해설은 한 줄만 봐도 보인다.
    if (expl?.question_text && r.reason === "wrong_explanation") {
      const { data: sib } = await sb
        .from("exam_papers")
        .select("id,subject_id")
        .eq("exam_type_id", p.exam_type_id)
        .eq("year", p.year)
        .eq("round", p.round)
        .eq("level", p.level ?? null);
      const others = (sib ?? []).filter((s) => s.id !== p.id);
      if (others.length > 0) {
        const { data: oq } = await sb
          .from("questions")
          .select("id,paper_id")
          .in("paper_id", others.map((s) => s.id))
          .eq("question_number", r.question_number);
        const { data: oe } = oq?.length
          ? await sb
              .from("question_explanations")
              .select("question_id,question_text")
              .in("question_id", oq.map((x) => x.id))
          : { data: [] };
        const paperOf = new Map((oq ?? []).map((x) => [x.id, x.paper_id]));
        const subjectOf = new Map(others.map((s) => [s.id, subjectName.get(s.subject_id) ?? "?"]));
        console.log(`  같은 회차 ${r.question_number}번 해설 (이 중에 이 해설과 같은 내용이 있으면 교차오염):`);
        for (const e of oe ?? [])
          console.log(
            `     ${(subjectOf.get(paperOf.get(e.question_id)) ?? "?").padEnd(14)} ${(e.question_text ?? "").slice(0, 62).replace(/\n/g, " ")}`,
          );
      }
    }

    // --- 판정 요약 ---
    if (r.reason === "wrong_answer" && dbAnswer != null)
      console.log(`  → 판정: 위 '이 열이 이 문제지 것' 표시가 붙은 열의 문${r.question_number} 값과 DB(${dbAnswer})를 비교할 것. 같으면 오신고다.`);
  }
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
