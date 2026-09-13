// 한국사능력검정시험(한능검) 심화 기출 등록 전용 스크립트.
//
// 사용법:
//   node --env-file=.env.local scripts/upload-korean-history-exam.mjs --dir "C:/.../korea" [--dry] [--only 50,51]
//
// 이 시험은 공무원 시험과 구조가 달라 bulk-upload/upload-answer-key 를 그대로 쓸 수 없다:
//   - 과목이 하나뿐이고(한국사), 파일명에 과목명이 없다.
//   - 연도가 파일명에 없다. 대신 "제N회"가 시험을 가르는 축이라 round 에 회차를 넣고,
//     연도는 정답표 PDF 의 생성일(= 정답 공개일 = 시험 당일)에서 읽는다.
//   - 정답표가 한 회차에 한 장이고 레이아웃이 (문항번호|정답|배점) × 5묶음으로 고정이라,
//     범용 answer-grid-parser 대신 여기서 직접 파싱한다(원문자판/맨숫자판 둘 다 있음).
//
// 문제지 PDF 는 스캔본이라 텍스트 레이어가 없다 — 문항 이미지 크롭(question_images)은
// 이 스크립트의 범위가 아니다. CBT 는 PDF 뷰어 + OMR 이라 정답만 있으면 동작한다.
//
// **한국사(공무원) 과목과 절대 섞지 않는다.** 전용 subjects 행(korean-history-exam)에만
// 붙인다 — 과목 색인(ㅎ 탭)의 "한국사" 에 한능검 문제지가 섞여 들어가지 않게 하려는 것.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { optimizePdf } from "./lib/optimize-pdf.mjs";

const EXAM_TYPE_NAME = "한능검";
const SUBJECT_SLUG = "korean-history-exam";
const LEVEL = "심화";
const QUESTION_COUNT = 50;
const CHOICE_COUNT = 5;

const CIRCLED = { "①": 1, "②": 2, "③": 3, "④": 4, "⑤": 5 };

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) {
        args[key] = true;
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

/** "한국사능력검정시험 제72회 심화 문제.pdf" / "한능검 52회 심화 정답.pdf" -> 72 / 52 */
function roundFromFilename(name) {
  const m = name.match(/제?\s*(\d{1,3})\s*회/);
  return m ? Number(m[1]) : null;
}

/** PDF 생성일(D:YYYYMMDD...) -> 연도. 정답표는 시험 당일 공개되므로 시험 연도와 같다. */
function yearFromPdfDate(raw) {
  const m = (raw ?? "").match(/D:(\d{4})/);
  return m ? Number(m[1]) : null;
}

/**
 * 정답표 한 장에서 (문항번호 -> 정답) 을 읽는다.
 *
 * 판형이 둘이다:
 *   (A) 정답이 원문자 ①~⑤ (대부분)
 *   (B) 정답이 맨숫자 (58회·73회) — 배점 숫자와 구분이 안 되므로 행 안의 토큰을
 *       [번호, 정답, 배점] 3개씩 끊어 읽고, 번호 집합이 정확히 1~50 인지로 검증한다.
 *
 * 어느 판형이든 "번호 1~50 전부 + 정답 1~5" 를 만족하지 못하면 실패로 보고하고
 * 절대 추측하지 않는다.
 */
async function parseAnswerPdf(pdfjs, buffer) {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
  }).promise;

  const rows = [];
  let hasCircled = false;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = [];
    for (const item of content.items) {
      const s = (item.str || "").trim();
      if (!s) continue;
      if ([...s].some((ch) => CIRCLED[ch] !== undefined)) hasCircled = true;
      items.push({ s, x: item.transform[4], y: item.transform[5] });
    }
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    for (const item of items) {
      const row = rows.find((r) => r.page === p && Math.abs(r.y - item.y) <= 3);
      if (row) row.items.push(item);
      else rows.push({ page: p, y: item.y, items: [item] });
    }
  }

  const answers = new Map();
  const voided = new Set();
  const conflicts = [];

  const put = (n, a) => {
    if (answers.has(n) && answers.get(n) !== a) conflicts.push(n);
    answers.set(n, a);
  };

  for (const row of rows) {
    row.items.sort((a, b) => a.x - b.x);
    const toks = [];
    for (const item of row.items) {
      // 한 item 안에 "1 ② 1" 처럼 여러 토큰이 붙어 오기도 하고, 원문자가 숫자에
      // 붙어 오기도 한다("1②"). 둘 다 쪼갠다.
      for (const chunk of item.s.split(/\s+/)) {
        if (!chunk) continue;
        let buf = "";
        for (const ch of chunk) {
          if (CIRCLED[ch] !== undefined) {
            if (buf) toks.push(buf);
            buf = "";
            toks.push(ch);
          } else {
            buf += ch;
          }
        }
        if (buf) toks.push(buf);
      }
    }

    if (hasCircled) {
      // (A) 숫자 바로 뒤에 원문자(또는 "없음")가 오는 자리만 취한다.
      for (let i = 0; i + 1 < toks.length; i++) {
        const num = toks[i];
        const ans = toks[i + 1];
        if (!/^\d{1,2}$/.test(num)) continue;
        if (CIRCLED[ans] !== undefined) {
          put(Number(num), CIRCLED[ans]);
          i++;
        } else if (ans === "없음") {
          // 전원 정답 처리(문항 이의심사 결과). 자리값은 규약대로 1 을 채우고
          // voided_questions 로 넘긴다.
          put(Number(num), 1);
          voided.add(Number(num));
          i++;
        }
      }
    } else {
      // (B) 맨숫자 판형: 헤더 낱말을 버리고 남은 숫자를 3개씩 끊는다.
      const nums = toks.filter((t) => /^\d{1,2}$/.test(t)).map(Number);
      for (let i = 0; i + 2 < nums.length; i += 3) {
        const [n, a, score] = [nums[i], nums[i + 1], nums[i + 2]];
        if (n < 1 || n > QUESTION_COUNT) break;
        if (a < 1 || a > CHOICE_COUNT) break;
        if (score < 1 || score > 3) break;
        put(n, a);
      }
    }
  }

  const missing = [];
  for (let n = 1; n <= QUESTION_COUNT; n++) if (!answers.has(n)) missing.push(n);

  return {
    list:
      missing.length === 0 && conflicts.length === 0
        ? Array.from({ length: QUESTION_COUNT }, (_, i) => answers.get(i + 1))
        : null,
    voided: [...voided].sort((a, b) => a - b),
    missing,
    conflicts,
    layout: hasCircled ? "원문자" : "맨숫자",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dir;
  const dry = !!args.dry;
  const only = args.only
    ? new Set(String(args.only).split(",").map((v) => Number(v.trim())))
    : null;

  if (!dir) {
    console.error(
      '사용법: node --env-file=.env.local scripts/upload-korean-history-exam.mjs --dir "C:/.../korea" [--dry]',
    );
    process.exit(1);
  }

  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

  const files = (await readdir(dir)).filter((f) => f.toLowerCase().endsWith(".pdf"));

  // 회차별로 문제지/정답표를 짝짓는다. "(1)" 같은 중복 내려받기 사본은 버린다.
  const byRound = new Map();
  for (const f of files) {
    const round = roundFromFilename(f);
    if (!round) {
      console.warn(`회차를 못 읽어 건너뜀: ${f}`);
      continue;
    }
    const kind = f.includes("정답") ? "answer" : f.includes("문제") ? "paper" : null;
    if (!kind) {
      console.warn(`문제/정답 구분이 없어 건너뜀: ${f}`);
      continue;
    }
    const entry = byRound.get(round) ?? { round };
    if (entry[kind]) {
      console.warn(`중복 사본 무시: ${f} (이미 ${entry[kind]})`);
      continue;
    }
    entry[kind] = f;
    byRound.set(round, entry);
  }

  const rounds = [...byRound.values()]
    .filter((e) => !only || only.has(e.round))
    .sort((a, b) => a.round - b.round);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: examType } = await supabase
    .from("exam_types")
    .select("id")
    .eq("name", EXAM_TYPE_NAME)
    .maybeSingle();
  const { data: subject } = await supabase
    .from("subjects")
    .select("id, name")
    .eq("slug", SUBJECT_SLUG)
    .maybeSingle();

  if (!dry && (!examType || !subject)) {
    console.error(
      `먼저 exam_types("${EXAM_TYPE_NAME}")와 subjects("${SUBJECT_SLUG}") 행을 만들어야 합니다.`,
    );
    process.exit(1);
  }

  const failed = [];
  let done = 0;

  for (const entry of rounds) {
    const { round, paper: paperFile, answer: answerFile } = entry;
    if (!paperFile || !answerFile) {
      failed.push(`제${round}회 (문제지 또는 정답표 누락: 문제=${paperFile}, 정답=${answerFile})`);
      continue;
    }

    const answerRaw = await readFile(`${dir}/${answerFile}`);
    const answerDoc = await pdfjs.getDocument({ data: new Uint8Array(answerRaw) }).promise;
    const year = yearFromPdfDate((await answerDoc.getMetadata()).info?.CreationDate);
    if (!year) {
      failed.push(`제${round}회 (정답표에서 연도를 못 읽음)`);
      continue;
    }

    const parsed = await parseAnswerPdf(pdfjs, answerRaw);
    if (!parsed.list) {
      failed.push(
        `제${round}회 (정답 파싱 실패 — 누락 ${parsed.missing.join(",") || "없음"}, 충돌 ${parsed.conflicts.join(",") || "없음"})`,
      );
      continue;
    }

    const title = `${year} ${EXAM_TYPE_NAME} 제${round}회 ${LEVEL}`;
    console.log(
      `${title} | ${parsed.layout} | 정답 ${parsed.list.join("")}${parsed.voided.length ? ` | 전원정답 ${parsed.voided.join(",")}` : ""}`,
    );
    if (dry) {
      done++;
      continue;
    }

    // 1) 문제지 PDF 업로드 + exam_papers
    const { data: existing } = await supabase
      .from("exam_papers")
      .select("id")
      .eq("exam_type_id", examType.id)
      .eq("year", year)
      .eq("round", round)
      .eq("subject_id", subject.id)
      .maybeSingle();

    let paperId = existing?.id ?? null;
    if (!paperId) {
      const paperBuffer = await optimizePdf(await readFile(`${dir}/${paperFile}`));
      const storagePath = `${year}/${randomUUID()}.pdf`;
      const { error: uploadError } = await supabase.storage
        .from("exam-papers")
        .upload(storagePath, paperBuffer, { contentType: "application/pdf" });
      if (uploadError) {
        failed.push(`${title} (문제지 업로드 실패: ${uploadError.message})`);
        continue;
      }
      const { data: inserted, error: insertError } = await supabase
        .from("exam_papers")
        .insert({
          subject_id: subject.id,
          exam_type_id: examType.id,
          year,
          round,
          level: LEVEL,
          track: null,
          title,
          file_path: storagePath,
          file_name: paperFile,
          file_size: paperBuffer.byteLength,
          question_count: QUESTION_COUNT,
          choice_count: CHOICE_COUNT,
        })
        .select("id")
        .single();
      if (insertError) {
        await supabase.storage.from("exam-papers").remove([storagePath]);
        failed.push(`${title} (문제지 저장 실패: ${insertError.message})`);
        continue;
      }
      paperId = inserted.id;
    }

    // 2) 정답표 PDF 업로드 + answer_keys (회차당 한 장)
    const { data: keyExisting } = await supabase
      .from("answer_keys")
      .select("id")
      .eq("exam_type_id", examType.id)
      .eq("year", year)
      .eq("level", LEVEL)
      .eq("round", round)
      .is("track", null)
      .maybeSingle();

    if (!keyExisting) {
      const answerBuffer = await optimizePdf(answerRaw);
      const keyPath = `answers/${year}/${randomUUID()}.pdf`;
      const { error: keyUploadError } = await supabase.storage
        .from("exam-papers")
        .upload(keyPath, answerBuffer, { contentType: "application/pdf" });
      if (keyUploadError) {
        failed.push(`${title} (정답표 업로드 실패: ${keyUploadError.message})`);
        continue;
      }
      const { error: keyError } = await supabase.from("answer_keys").upsert(
        {
          exam_type_id: examType.id,
          year,
          level: LEVEL,
          round,
          track: null,
          file_path: keyPath,
          file_name: answerFile,
          file_size: answerBuffer.byteLength,
        },
        { onConflict: "exam_type_id,year,level,round,track" },
      );
      if (keyError) {
        await supabase.storage.from("exam-papers").remove([keyPath]);
        failed.push(`${title} (정답표 저장 실패: ${keyError.message})`);
        continue;
      }
    }

    // 3) paper_answers
    const { error: answersError } = await supabase.from("paper_answers").upsert(
      {
        paper_id: paperId,
        answers: parsed.list,
        voided_questions: parsed.voided,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "paper_id" },
    );
    if (answersError) {
      failed.push(`${title} (정답 저장 실패: ${answersError.message})`);
      continue;
    }

    done++;
  }

  console.log(`\n${dry ? "검증" : "등록"} 완료: ${done}개 회차`);
  if (failed.length) {
    console.log(`실패 (${failed.length}개):`);
    failed.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
