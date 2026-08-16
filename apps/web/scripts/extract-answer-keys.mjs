// 사용법: npm run extract-answers -- --answer-key-id <uuid>
//
// answer_keys에 이미 업로드된 정답표 PDF 한 장을 Claude(비전)에게 읽혀서 과목별 정답
// 배열을 한 번에 추출하고, 그 시험(exam_type_id+year+level+round+track) 조건에 맞는
// 모든 exam_papers(과목별 문제지)의 paper_answers를 자동으로 채운다. choice_count와
// question_count는 관리자 화면(admin/actions.ts의 savePaperAnswers)과 동일한 규칙
// (정답 배열 자체에서 추론)으로 계산해 exam_papers에도 반영한다.
//
// 텍스트 레이어 교차 검증 (2026-08-16 이후 필수 게이트): 비전 추출이 격자 중간
// 구간을 오독해 국회직 9급 정답 49셀이 오염된 사고가 있었다 (AI 해설 배치의
// unverified 급증으로 발견 — docs/agents/answer-keys-tracks.md). 그래서 저장 전에
// lib/answer-grid-parser.mjs로 PDF 텍스트 레이어를 결정적으로 파싱해 추출 결과와
// 셀 단위 대조하고, **불일치하는 과목은 저장하지 않고 보고만** 한다. 텍스트
// 레이어가 없거나(스캔본) 열을 못 찾은 과목은 종전처럼 저장하되 "교차 검증 불가"로
// 집계해 알려준다 — 그 과목들은 저장 후 scripts/audit-answer-keys.mjs와 해설 배치의
// unverified 신호가 이중 안전망이다. 이 게이트는 "표를 옮겨 적다 생긴 오독"을 막는
// 것이고, 책형(가/나형) 선택이 문제지 이미지와 다른 경우는 못 잡는다 — 그건
// unverified 신호가 잡는다.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import {
  loadPdfjs,
  parseAnswerPdf,
  findSubjectColumns,
} from "./lib/answer-grid-parser.mjs";

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

const MAX_CHOICE_COUNT = 5;

// 정답이 그대로 노출되면 채점 의미가 없는 건 관리자 화면과 동일하지만, 이 스크립트는
// service_role로만 돌리는 오프라인 도구라 그 문제는 없다 (paper_answers RLS는 여전히
// anon/authenticated에는 select를 안 열어둔 채 유지된다).
const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    subjects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          subject_name: {
            type: "string",
            description: "문제지 목록에 주어진 과목명 중 정확히 하나",
          },
          track: {
            type: ["string", "null"],
            description:
              "이 정답 열이 속한 직류(track). 주어진 직류 목록 중 하나, 직렬 구분이 없는 정답표면 null",
          },
          answers: {
            type: "array",
            items: { type: "integer" },
            description: "1번 문제부터 순서대로 정답 번호",
          },
          voided_questions: {
            type: "array",
            items: { type: "integer" },
            description:
              "전항정답/복수정답/정답없음으로 처리된 문제 번호 (없으면 빈 배열)",
          },
        },
        required: ["subject_name", "track", "answers", "voided_questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["subjects"],
  additionalProperties: false,
};

function buildPrompt(subjectNames, trackNames) {
  const trackGuide =
    trackNames.length > 0
      ? `- 이 시험의 문제지에는 다음 직류(track)가 등록돼 있어: ${trackNames.join(", ")}.
  법원직처럼 정답표가 "◉ 법원사무직렬", "◉ 전산직렬" 등 직렬별 표로 나뉘어 있으면,
  각 (직렬, 과목) 조합마다 별도 항목을 만들고 track에 위 직류 목록에서 대응되는 값을
  정확히 넣어줘 (예: "전산직렬" 표 → "전산서기보"). 같은 과목이라도 직렬에 따라 문항
  수가 다를 수 있으니(예: 서기보 국어 15문항 vs 법원사무 국어 25문항) 각 표에 실제로
  인쇄된 개수만큼만 뽑아야 해.
- 직렬 구분이 없는 단일 정답표면 track은 null로 해줘.`
      : `- track은 항상 null로 해줘.`;
  return `첨부된 PDF는 공무원 시험 정답표야. 이 시험에 포함된 과목별로 1번 문제부터 순서대로 정답 번호를 뽑아줘.

- subject_name은 반드시 다음 목록 중 하나와 정확히 일치해야 해: ${subjectNames.join(", ")}
- 이 목록에 없는 과목은 결과에서 제외해줘.
${trackGuide}
- 책형이 여러 개면(①책형/②책형) ①책형 기준으로만 뽑아줘.
- "전항정답"/"복수정답"/"정답없음" 표시가 있는 문제 번호는 voided_questions에 넣어줘
  (없으면 빈 배열). 그 문제의 answers 값은 표기된 번호 중 첫 번째(정답없음이면 1)로 채워줘.
- 정답 값은 1~${MAX_CHOICE_COUNT} 사이 숫자여야 해.`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const answerKeyId = args["answer-key-id"];

  if (!answerKeyId) {
    console.error("사용법: npm run extract-answers -- --answer-key-id <uuid>");
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.error(
      ".env.local에 NEXT_PUBLIC_SUPABASE_URL과 SUPABASE_SERVICE_ROLE_KEY가 필요합니다.",
    );
    process.exit(1);
  }
  if (!anthropicApiKey) {
    console.error(".env.local에 ANTHROPIC_API_KEY가 필요합니다.");
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const { data: answerKey, error: answerKeyError } = await supabase
    .from("answer_keys")
    .select("*")
    .eq("id", answerKeyId)
    .single();

  if (answerKeyError || !answerKey) {
    console.error(`정답표를 찾을 수 없습니다: ${answerKeyId}`);
    process.exit(1);
  }

  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name");
  if (subjectsError) throw subjectsError;

  const subjectByName = new Map(subjects.map((s) => [s.name, s.id]));

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(answerKey.file_path);

  if (downloadError || !fileBlob) {
    console.error(`정답표 PDF 다운로드 실패: ${downloadError?.message}`);
    process.exit(1);
  }

  const pdfBuffer = Buffer.from(await fileBlob.arrayBuffer());
  const base64Pdf = pdfBuffer.toString("base64");

  // 텍스트 레이어 증인 준비 — 실패해도 추출은 계속한다 (검증 불가로 집계).
  let witnessPages = null;
  try {
    const pdfjs = await loadPdfjs();
    const parsed = await parseAnswerPdf(pdfjs, pdfBuffer);
    if (parsed.hasText) witnessPages = parsed.pages;
    else console.log("경고: 정답표에 텍스트 레이어가 없습니다(스캔본) — 교차 검증 없이 진행.");
  } catch (e) {
    console.log(`경고: 텍스트 레이어 파싱 실패 (${e?.message ?? e}) — 교차 검증 없이 진행.`);
  }

  // 이 시험에 실제로 등록된 문제지들을 먼저 모아, 직류(track) 목록을 프롬프트에 넘기고
  // 추출 결과를 문제지 단위로 대조한다. 법원직처럼 한 정답표 안에 직렬별 표가 여러 개
  // 있는 경우(track별 문제지가 따로 있는 경우)를 놓치지 않기 위한 것 — 예전에는
  // answerKey.track(null)과 정확히 일치하는 문제지만 찾아서, track 붙은 문제지 전체가
  // "일치하는 문제지 없음"으로 조용히 스킵됐다 (2026-07-17 법원직 106건 미등록 사고).
  let candidatesQuery = supabase
    .from("exam_papers")
    .select("id, title, subject_id, track, question_count")
    .eq("exam_type_id", answerKey.exam_type_id)
    .eq("year", answerKey.year)
    .eq("round", answerKey.round);
  candidatesQuery = answerKey.level
    ? candidatesQuery.eq("level", answerKey.level)
    : candidatesQuery.is("level", null);
  // answer_keys.track이 지정된 정답표(근로감독 등 특수모집 전용)는 그 직류만 대상.
  if (answerKey.track) candidatesQuery = candidatesQuery.eq("track", answerKey.track);

  const { data: candidatePapers, error: candidatesError } = await candidatesQuery;
  if (candidatesError) throw candidatesError;
  if (!candidatePapers || candidatePapers.length === 0) {
    console.error("이 시험 조건에 해당하는 문제지가 없습니다.");
    process.exit(1);
  }

  const trackNames = [
    ...new Set(candidatePapers.map((p) => p.track).filter(Boolean)),
  ];

  console.log(`Claude에게 정답표 분석 요청 중... (${answerKey.file_name})`);

  // 단순 표 형태의 정답을 옮겨 적는 작업이라 Haiku로도 되긴 하지만, 실제 학생 채점에
  // 그대로 쓰이는 값이라 정확도를 우선해 Sonnet을 기본값으로 둔다.
  const response = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 8192,
    output_config: { format: { type: "json_schema", schema: ANSWER_SCHEMA } },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            type: "text",
            text: buildPrompt(subjects.map((s) => s.name), trackNames),
          },
        ],
      },
    ],
  });

  if (response.stop_reason === "refusal") {
    console.error("Claude가 분석을 거부했습니다.");
    process.exit(1);
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    console.error("Claude 응답에서 결과를 찾을 수 없습니다.");
    process.exit(1);
  }

  const { subjects: extracted } = JSON.parse(textBlock.text);

  // 값 검증을 먼저 통과한 항목만 대조에 쓴다.
  const validEntries = [];
  const skipped = [];
  for (const item of extracted) {
    const subjectId = subjectByName.get(item.subject_name);
    if (!subjectId) {
      skipped.push(`${item.subject_name} (등록되지 않은 과목명)`);
      continue;
    }
    if (
      item.answers.length === 0 ||
      item.answers.some(
        (n) => !Number.isInteger(n) || n < 1 || n > MAX_CHOICE_COUNT,
      )
    ) {
      skipped.push(
        `${item.subject_name}${item.track ? ` (${item.track})` : ""} (정답 값이 1~${MAX_CHOICE_COUNT} 범위를 벗어남)`,
      );
      continue;
    }
    validEntries.push({ ...item, subject_id: subjectId });
  }

  // 추출 항목이 아니라 "문제지" 기준으로 순회한다. 정답표에 있는데 대응 문제지가
  // 없으면 아래에서 따로 경고하고, 문제지가 있는데 대응 항목이 없으면 여기서 바로
  // 드러난다 — 어느 쪽도 조용히 사라지지 않게 하는 게 핵심.
  const entrySignature = (e) =>
    JSON.stringify([e.answers, e.voided_questions ?? []]);
  const usedEntries = new Set();
  let updated = 0;
  let witnessedCount = 0;
  const unwitnessed = [];
  const subjectNameById = new Map(subjects.map((s) => [s.id, s.name]));
  const candidateSubjectNames = candidatePapers.map(
    (p) => subjectNameById.get(p.subject_id) ?? "",
  );

  for (const paper of candidatePapers) {
    const entries = validEntries.filter((e) => e.subject_id === paper.subject_id);
    if (entries.length === 0) continue; // 이 과목은 정답표에 없음 (아래에서 집계)

    // 1순위: 직류가 정확히 일치하는 항목.
    let pick = entries.find((e) => (e.track ?? null) === (paper.track ?? null));
    if (!pick) {
      // 2순위: 문항 수가 이미 알려져 있으면 길이가 유일하게 일치하는 항목.
      if (paper.question_count != null) {
        const byLength = entries.filter(
          (e) => e.answers.length === paper.question_count,
        );
        if (new Set(byLength.map(entrySignature)).size === 1) pick = byLength[0];
      }
      // 3순위: 모든 직렬의 정답이 완전히 동일하면 무엇을 써도 같으므로 사용.
      if (!pick && new Set(entries.map(entrySignature)).size === 1) {
        pick = entries[0];
      }
      // 4순위: track 없는 문제지(공통과목 원본)는 가장 긴 판이 유일하면 그걸 쓴다.
      // (법원직: 서기보 국어 15문항 vs 법원사무 국어 25문항 — null-track 문제지는 25문항 판)
      if (!pick && paper.track == null) {
        const maxLen = Math.max(...entries.map((e) => e.answers.length));
        const longest = entries.filter((e) => e.answers.length === maxLen);
        if (new Set(longest.map(entrySignature)).size === 1) pick = longest[0];
      }
    }

    if (!pick) {
      skipped.push(
        `${paper.title} (직류 대응 항목을 확정할 수 없음 — 정답표 직렬 구분 확인 필요)`,
      );
      continue;
    }

    // 안전장치: 문항 수가 이미 등록된 문제지에 길이가 다른 정답을 덮어쓰지 않는다.
    // (실측 사고: 25문항 정답을 15문항짜리 서기보 문제지에 복사해 CBT 문항 수가 깨짐)
    if (
      paper.question_count != null &&
      paper.question_count !== pick.answers.length
    ) {
      skipped.push(
        `${paper.title} (문항 수 불일치: 문제지 ${paper.question_count} vs 정답 ${pick.answers.length}개 — 직류별 문항 수 확인 필요)`,
      );
      continue;
    }

    // 텍스트 레이어 증인 게이트: 추출 배열이 PDF의 어느 후보 열과도 (voided·빈 셀
    // 제외) 완전 일치하지 않으면 저장하지 않는다 — 비전 오독 방지의 핵심 장치.
    if (witnessPages) {
      const cols = findSubjectColumns(
        witnessPages,
        subjectNameById.get(paper.subject_id) ?? "",
        candidateSubjectNames,
        pick.answers.length,
        paper,
      );
      if (cols.length === 0) {
        unwitnessed.push(paper.title);
      } else {
        const voided = new Set(pick.voided_questions ?? []);
        const diffsOf = (c) => {
          const cells = [];
          for (let qn = 1; qn <= pick.answers.length; qn++) {
            if (voided.has(qn) || !c.map.has(qn)) continue;
            if (c.map.get(qn) !== pick.answers[qn - 1])
              cells.push(`문${qn} 추출${pick.answers[qn - 1]}≠PDF${c.map.get(qn)}`);
          }
          return cells;
        };
        const best = cols.map(diffsOf).sort((a, b) => a.length - b.length)[0];
        if (best.length > 0) {
          skipped.push(
            `${paper.title} (텍스트 레이어와 ${best.length}셀 불일치: ${best.slice(0, 5).join(", ")}${best.length > 5 ? " …" : ""} — 오독 방지를 위해 저장 안 함, PDF 확인 후 수동 등록 필요)`,
          );
          continue;
        }
        witnessedCount++;
      }
    }

    usedEntries.add(pick);
    const choiceCount = Math.max(4, ...pick.answers);

    const { error: paperUpdateError } = await supabase
      .from("exam_papers")
      .update({ choice_count: choiceCount, question_count: pick.answers.length })
      .eq("id", paper.id);
    if (paperUpdateError) {
      skipped.push(
        `${paper.title} (문제지 업데이트 실패: ${paperUpdateError.message})`,
      );
      continue;
    }

    const { error: upsertError } = await supabase.from("paper_answers").upsert(
      {
        paper_id: paper.id,
        answers: pick.answers,
        voided_questions: pick.voided_questions ?? [],
        updated_at: new Date().toISOString(),
      },
      { onConflict: "paper_id" },
    );
    if (upsertError) {
      skipped.push(`${paper.title} (정답 저장 실패: ${upsertError.message})`);
      continue;
    }

    updated++;
    console.log(`완료: ${paper.title} (${pick.answers.length}문항)`);
  }

  // 정답표에서 뽑혔는데 어느 문제지에도 안 쓰인 항목 — 문제지 미업로드이거나 직류
  // 대응 실패. 조용히 넘어가지 않고 알려준다.
  for (const e of validEntries) {
    if (!usedEntries.has(e)) {
      skipped.push(
        `${e.subject_name}${e.track ? ` (${e.track})` : ""} (정답은 추출됐지만 대응 문제지 없음)`,
      );
    }
  }

  console.log(`\n총 ${updated}개 문제지 정답 저장 완료.`);
  if (witnessPages) {
    console.log(
      `텍스트 레이어 교차 검증: 일치 ${witnessedCount}개${unwitnessed.length > 0 ? `, 검증 불가(열 미발견) ${unwitnessed.length}개 — 저장은 했으니 scripts/audit-answer-keys.mjs로 사후 확인 권장: ${unwitnessed.join(", ")}` : ""}`,
    );
  } else if (updated > 0) {
    console.log(
      "텍스트 레이어가 없어 교차 검증 없이 저장했습니다 — scripts/audit-answer-keys.mjs 사후 감사와 해설 배치 unverified 신호로 확인할 것.",
    );
  }
  if (skipped.length > 0) {
    console.log(`건너뜀 (${skipped.length}개):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
