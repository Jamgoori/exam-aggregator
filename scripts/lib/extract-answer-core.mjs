// answer_keys 한 행(정답표 PDF)을 Claude(비전)에게 읽혀서 과목별 정답 배열을 뽑아내고,
// 그 시험(exam_type_id+year+level+round+track) 조건에 맞는 exam_papers(과목별 문제지)의
// paper_answers를 채우는 핵심 로직. extract-answer-keys.mjs(CLI)와 업로드 스크립트들의
// 자동 반영(upload-answer-key.mjs, bulk-upload.mjs, batch-extract-answers.mjs)이 공유한다.

import Anthropic from "@anthropic-ai/sdk";

const MAX_CHOICE_COUNT = 5;

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

// supabase는 service_role 클라이언트여야 한다(paper_answers는 authenticated+admin에만 쓰기 허용).
export async function extractAndSaveAnswers({ supabase, anthropicApiKey, answerKey }) {
  const anthropic = new Anthropic({ apiKey: anthropicApiKey });

  const { data: subjects, error: subjectsError } = await supabase
    .from("subjects")
    .select("id, name");
  if (subjectsError) throw subjectsError;

  const subjectByName = new Map(subjects.map((s) => [s.name, s.id]));

  const { data: fileBlob, error: downloadError } = await supabase.storage
    .from("exam-papers")
    .download(answerKey.file_path);

  if (downloadError || !fileBlob) {
    throw new Error(`정답표 PDF 다운로드 실패: ${downloadError?.message}`);
  }

  const base64Pdf = Buffer.from(await fileBlob.arrayBuffer()).toString("base64");

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
    throw new Error("Claude가 분석을 거부했습니다.");
  }

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) {
    throw new Error("Claude 응답에서 결과를 찾을 수 없습니다.");
  }

  const { subjects: extracted } = JSON.parse(textBlock.text);

  let updated = 0;
  const skipped = [];
  const updatedPapers = [];

  for (const item of extracted) {
    const subjectId = subjectByName.get(item.subject_name);
    if (!subjectId) {
      skipped.push(`${item.subject_name} (등록되지 않은 과목명)`);
      continue;
    }

    const answers = item.answers;
    if (
      answers.length === 0 ||
      answers.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_CHOICE_COUNT)
    ) {
      skipped.push(`${item.subject_name} (정답 값이 1~${MAX_CHOICE_COUNT} 범위를 벗어남)`);
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
        skipped.push(`${paper.title} (문제지 업데이트 실패: ${paperUpdateError.message})`);
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
      updatedPapers.push({ id: paper.id, title: paper.title });
    }
  }

  return { updated, skipped, updatedPapers };
}
