// 사용법: npm run extract-answers -- --answer-key-id <uuid>
//
// answer_keys에 이미 업로드된 정답표 PDF 한 장을 Claude(비전)에게 읽혀서 과목별 정답
// 배열을 한 번에 추출하고, 그 시험(exam_type_id+year+level+round+track) 조건에 맞는
// 모든 exam_papers(과목별 문제지)의 paper_answers를 자동으로 채운다. choice_count와
// question_count는 관리자 화면(admin/actions.ts의 savePaperAnswers)과 동일한 규칙
// (정답 배열 자체에서 추론)으로 계산해 exam_papers에도 반영한다.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

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
          answers: {
            type: "array",
            items: { type: "integer" },
            description: "1번 문제부터 순서대로 정답 번호",
          },
          voided_questions: {
            type: "array",
            items: { type: "integer" },
            description: "전항정답/복수정답으로 처리된 문제 번호 (없으면 빈 배열)",
          },
        },
        required: ["subject_name", "answers", "voided_questions"],
        additionalProperties: false,
      },
    },
  },
  required: ["subjects"],
  additionalProperties: false,
};

function buildPrompt(subjectNames) {
  return `첨부된 PDF는 공무원 시험 정답표야. 이 시험에 포함된 과목별로 1번 문제부터 순서대로 정답 번호를 뽑아줘.

- subject_name은 반드시 다음 목록 중 하나와 정확히 일치해야 해: ${subjectNames.join(", ")}
- 이 목록에 없는 과목은 결과에서 제외해줘.
- "전항정답"이나 "복수정답" 표시가 있는 문제 번호는 voided_questions에 넣어줘 (없으면 빈 배열).
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

  const base64Pdf = Buffer.from(await fileBlob.arrayBuffer()).toString(
    "base64",
  );

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
          { type: "text", text: buildPrompt(subjects.map((s) => s.name)) },
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

  let updated = 0;
  const skipped = [];

  for (const item of extracted) {
    const subjectId = subjectByName.get(item.subject_name);
    if (!subjectId) {
      skipped.push(`${item.subject_name} (등록되지 않은 과목명)`);
      continue;
    }

    const answers = item.answers;
    if (
      answers.length === 0 ||
      answers.some(
        (n) => !Number.isInteger(n) || n < 1 || n > MAX_CHOICE_COUNT,
      )
    ) {
      skipped.push(
        `${item.subject_name} (정답 값이 1~${MAX_CHOICE_COUNT} 범위를 벗어남)`,
      );
      continue;
    }

    let papersQuery = supabase
      .from("exam_papers")
      .select("id, title")
      .eq("exam_type_id", answerKey.exam_type_id)
      .eq("year", answerKey.year)
      .eq("round", answerKey.round)
      .eq("subject_id", subjectId);
    papersQuery = answerKey.level
      ? papersQuery.eq("level", answerKey.level)
      : papersQuery.is("level", null);
    papersQuery = answerKey.track
      ? papersQuery.eq("track", answerKey.track)
      : papersQuery.is("track", null);

    const { data: papers, error: papersError } = await papersQuery;
    if (papersError) throw papersError;

    if (!papers || papers.length === 0) {
      skipped.push(`${item.subject_name} (일치하는 문제지 없음)`);
      continue;
    }

    const choiceCount = Math.max(4, ...answers);

    for (const paper of papers) {
      const { error: paperUpdateError } = await supabase
        .from("exam_papers")
        .update({ choice_count: choiceCount, question_count: answers.length })
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
          answers,
          voided_questions: item.voided_questions ?? [],
          updated_at: new Date().toISOString(),
        },
        { onConflict: "paper_id" },
      );

      if (upsertError) {
        skipped.push(`${paper.title} (정답 저장 실패: ${upsertError.message})`);
        continue;
      }

      updated++;
      console.log(`완료: ${paper.title}`);
    }
  }

  console.log(`\n총 ${updated}개 문제지 정답 저장 완료.`);
  if (skipped.length > 0) {
    console.log(`건너뜀 (${skipped.length}개):`);
    skipped.forEach((s) => console.log(`  - ${s}`));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
