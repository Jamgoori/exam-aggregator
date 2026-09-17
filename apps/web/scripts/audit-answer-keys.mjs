// 사용법: node --env-file=.env.local scripts/audit-answer-keys.mjs [--exam 국회직] [--key-id uuid] [--out report.json]
//
// 등록된 정답표 PDF의 "텍스트 레이어"를 좌표 파싱(lib/answer-grid-parser.mjs)해
// DB paper_answers와 셀 단위로 대조하는 읽기 전용 감사 도구 (소유자 전용 — service
// role 키 필요). 아무것도 쓰지 않는다.
//
// 배경: 2026-08-16, AI 해설 배치의 unverified 급증을 추적하다 정답 등록 파이프라인
// (extract-answer-keys.mjs의 Claude 비전 추출)이 국회직 9급 2015·2018 정답표의
// 열 중간 구간을 오독해 13개 문제지 40셀이 오염된 것을 발견했다. 채점(CBT)과 해설
// 검증이 모두 이 값을 쓰므로, 텍스트 레이어가 있는 정답표는 이 도구로 전량 재검증한다.
//
// 판정:
//   clean        — PDF 열과 DB 배열이 완전 일치 (voided 위치는 대조 제외)
//   diff         — 셀 불일치 발견. cells에 [{qn, db, pdf, ai}] 나열 (ai = 해설봇이
//                  저장한 정답 번호; 있으면 제3의 증인이다)
//   no_answers   — DB에 paper_answers 없음
//   no_column    — PDF에서 과목 열을 못 찾음 (헤더 인식 실패 or 과목 미포함)
//   len_mismatch — 열은 찾았지만 문항 수가 다름
//   no_text      — PDF에 텍스트 레이어 없음 (스캔본) — 파서로 검증 불가
//   ambiguous    — 같은 과목·같은 길이 열이 여러 개인데 값이 서로 달라 판정 불가
//                  (직렬별 표 — 최소 diff 열 기준으로 cells는 참고용 표기)
//
// diff가 곧 "DB가 틀렸다"는 아니다 — 가/나(가/다)형 등 책형이 다른 열과 비교됐을
// 수도 있다. 페이지·표마다 대조해 diff가 가장 적은 열을 고르므로, 책형 회전이 있는
// PDF라면 맞는 책형 열이 자동으로 선택된다. 수정 전에 반드시 cells의 ai 증인과
// 원본 PDF를 확인할 것.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import {
  loadPdfjs,
  parseAnswerPdf,
  findSubjectColumns,
  normalizeSubjectName,
} from "./lib/answer-grid-parser.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) args[key] = true;
      else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// 키셋(cursor) 페이징. offset(range) 페이징은 깊은 페이지에서 매번 앞쪽을 다시 읽어,
// questions/question_explanations 처럼 10만 행대가 되면 statement timeout 으로 감사가
// 통째로 죽는다 (실측: 2026-09-17 question_explanations 10만 행에서 발생). key 는
// 유일·정렬 가능한 열이어야 하고(uuid pk 등), select 에 없으면 자동으로 끼워 넣는다.
async function pageAll(supabase, table, select, key = "id") {
  const cols = select.split(",").map((c) => c.trim());
  const query = cols.includes(key) ? select : `${key}, ${select}`;
  const rows = [];
  const PAGE = 1000;
  let cursor = null;
  for (;;) {
    let q = supabase.from(table).select(query).order(key).limit(PAGE);
    if (cursor !== null) q = q.gt(key, cursor);
    const { data, error } = await q;
    if (error) throw new Error(`${table} 조회 실패: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
    cursor = data[data.length - 1][key];
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.error("환경변수 필요: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const pdfjs = await loadPdfjs();

  const [examTypes, subjects, papers, answers] = [
    await pageAll(supabase, "exam_types", "id, name"),
    await pageAll(supabase, "subjects", "id, name"),
    await pageAll(
      supabase,
      "exam_papers",
      "id, title, exam_type_id, year, level, round, track, subject_id",
    ),
    await pageAll(supabase, "paper_answers", "paper_id, answers, voided_questions", "paper_id"),
  ];
  const typeName = new Map(examTypes.map((t) => [t.id, t.name]));
  const subjectName = new Map(subjects.map((s) => [s.id, s.name]));
  const answersByPaper = new Map(answers.map((a) => [a.paper_id, a]));

  let keysQuery = supabase.from("answer_keys").select("*");
  if (args["key-id"]) keysQuery = keysQuery.eq("id", args["key-id"]);
  const { data: keys, error: keysError } = await keysQuery.order("created_at");
  if (keysError) throw keysError;
  const targetKeys = (keys ?? []).filter(
    (k) => !args["exam"] || typeName.get(k.exam_type_id) === args["exam"],
  );
  console.error(`감사 대상 정답표: ${targetKeys.length}장`);

  // AI 해설이 저장한 정답 번호 (제3의 증인). 문제지·문항번호로 찾는다.
  const explRows = await pageAll(
    supabase,
    "question_explanations",
    "question_id, correct_choice_number, verified",
  );
  const questionRows = await pageAll(supabase, "questions", "id, paper_id, question_number");
  const questionById = new Map(questionRows.map((q) => [q.id, q]));
  const aiByPaperQn = new Map();
  for (const e of explRows) {
    const q = questionById.get(e.question_id);
    if (q) aiByPaperQn.set(`${q.paper_id}|${q.question_number}`, e.correct_choice_number);
  }

  const report = [];
  const counts = {};
  const bump = (s) => (counts[s] = (counts[s] ?? 0) + 1);

  for (const key of targetKeys) {
    const entry = {
      key_id: key.id,
      exam: typeName.get(key.exam_type_id) ?? key.exam_type_id,
      year: key.year,
      level: key.level,
      round: key.round,
      file_name: key.file_name,
      papers: [],
    };
    report.push(entry);

    // 공용(track null) 정답표는 그 시험의 모든 직류를 커버하는 게 기본이지만,
    // 그 직류 전용 정답표가 따로 있으면(소방 경채 등) 거기까지 덮지는 않는다 —
    // 소방은 같은 해 공채·경채가 과목명만 같고 문제가 달라, 안 걸러내면 경채
    // 문제지가 공채 정답표와도 대조돼 가짜 diff가 난다.
    const ownKeyTracks = new Set(
      (keys ?? [])
        .filter(
          (k) =>
            k.track &&
            k.exam_type_id === key.exam_type_id &&
            k.year === key.year &&
            k.round === key.round &&
            k.level === key.level,
        )
        .map((k) => k.track),
    );
    const candidates = papers.filter(
      (p) =>
        p.exam_type_id === key.exam_type_id &&
        p.year === key.year &&
        p.round === key.round &&
        (key.level ? p.level === key.level : p.level === null) &&
        (key.track ? p.track === key.track : !ownKeyTracks.has(p.track)),
    );
    if (candidates.length === 0) continue;

    const { data: blob, error: dlError } = await supabase.storage
      .from("exam-papers")
      .download(key.file_path);
    if (dlError || !blob) {
      entry.error = `다운로드 실패: ${dlError?.message}`;
      bump("download_error");
      continue;
    }
    let parsed;
    try {
      parsed = await parseAnswerPdf(pdfjs, await blob.arrayBuffer());
    } catch (e) {
      entry.error = `파싱 실패: ${e?.message ?? e}`;
      bump("parse_error");
      continue;
    }

    const candidateSubjects = candidates.map((p) => subjectName.get(p.subject_id) ?? "");
    for (const paper of candidates) {
      const pa = answersByPaper.get(paper.id);
      const sName = subjectName.get(paper.subject_id) ?? "?";
      const rec = { paper_id: paper.id, title: paper.title, subject: sName, track: paper.track };
      entry.papers.push(rec);
      if (!pa || !pa.answers) {
        rec.status = "no_answers";
        bump("no_answers");
        continue;
      }
      if (!parsed.hasText) {
        rec.status = "no_text";
        bump("no_text");
        continue;
      }
      const cols = findSubjectColumns(parsed.pages, sName, candidateSubjects, pa.answers.length, paper);
      if (cols.length === 0) {
        const anyLen = findColumnsAnyLength(parsed.pages, sName);
        rec.status = anyLen.length > 0 ? "len_mismatch" : "no_column";
        if (anyLen.length > 0) rec.pdf_lengths = anyLen.map((c) => c.values.length);
        bump(rec.status);
        continue;
      }
      const voided = new Set(pa.voided_questions ?? []);
      const scored = cols.map((c) => {
        const cells = [];
        const unchecked = [];
        for (let qn = 1; qn <= pa.answers.length; qn++) {
          if (voided.has(qn)) continue;
          if (!c.map.has(qn)) {
            unchecked.push(qn); // PDF 셀에 숫자가 없음 (전항정답 표기 등)
            continue;
          }
          if (pa.answers[qn - 1] !== c.map.get(qn))
            cells.push({
              qn,
              db: pa.answers[qn - 1],
              pdf: c.map.get(qn),
              ai: aiByPaperQn.get(`${paper.id}|${qn}`) ?? null,
            });
        }
        return { ...c, cells, unchecked };
      });
      scored.sort((a, b) => a.cells.length - b.cells.length);
      const best = scored[0];
      const exactMatches = scored.filter((s) => s.cells.length === 0);
      if (exactMatches.length > 0) {
        rec.status = "clean";
        rec.page = exactMatches[0].page;
        if (exactMatches[0].unchecked.length > 0)
          rec.unchecked = exactMatches[0].unchecked;
        bump("clean");
      } else if (
        scored.length > 1 &&
        scored[1].cells.length === best.cells.length
      ) {
        rec.status = "ambiguous";
        rec.cells = best.cells;
        bump("ambiguous");
      } else {
        // AI 해설 답이 diff 셀 전부에서 DB 편이면, 문제지(이미지)와 DB는 일치하고
        // PDF의 다른 책형 열과 비교됐을 공산이 크다 — 사람이 볼 때 참고할 표식.
        const witnessed = best.cells.filter((c) => c.ai != null);
        rec.status = "diff";
        rec.page = best.page;
        rec.cells = best.cells;
        rec.unchecked = best.unchecked.length > 0 ? best.unchecked : undefined;
        rec.likely_other_form =
          witnessed.length >= 5 && witnessed.every((c) => c.ai === c.db);
        bump(rec.likely_other_form ? "diff_other_form" : "diff");
        console.error(
          `DIFF${rec.likely_other_form ? "(책형의심)" : ""} ${paper.title} — ${best.cells.length}셀: ${best.cells
            .map((c) => `문${c.qn} DB${c.db}→PDF${c.pdf}${c.ai != null ? `(AI${c.ai})` : ""}`)
            .join(", ")}`,
        );
      }
      if (voided.size > 0) rec.voided_skipped = [...voided];
    }
  }

  console.error(`\n=== 감사 요약 ===`);
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.error(`${k.padEnd(14)} ${v}`);
  }
  const out = args["out"];
  if (out) {
    writeFileSync(out, JSON.stringify(report, null, 2));
    console.error(`보고서 저장: ${out}`);
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

// 길이 무관 열 탐색 (len_mismatch 진단용 — 길이 후보 보고)
function findColumnsAnyLength(pages, sName) {
  const target = normalizeSubjectName(sName);
  const out = [];
  for (const pg of pages) {
    for (const t of pg.tables) {
      for (const c of t.columns) {
        if (c.header === target || c.header.endsWith(target)) out.push(c);
      }
    }
  }
  return out;
}

main().catch((e) => {
  console.error(`실행 실패: ${e?.message ?? e}`);
  process.exit(1);
});
