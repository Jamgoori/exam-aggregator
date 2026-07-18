export const meta = {
  name: 'unit-tagging-path-a',
  description: '해설 텍스트 기반 단원 태깅 전량 처리 (Sonnet 분류 + 검증 저장)',
  phases: [{ title: 'Tag', detail: '청크별 Sonnet 분류 후 questions.unit_tag 저장' }],
}

// args: { repoDir, envPath, chunksDir, files: [chunk 파일명...] }
// args가 문자열(JSON)로 들어오는 경우 방어적으로 파싱.
const a = typeof args === 'string' ? JSON.parse(args) : args
const { repoDir, envPath, chunksDir, files } = a

phase('Tag')

const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['file', 'saved', 'rejected'],
  properties: {
    file: { type: 'string' },
    saved: { type: 'integer' },
    rejected: { type: 'integer' },
    note: { type: 'string' },
  },
}

const results = await pipeline(
  files,
  (file) =>
    agent(
      `You classify Korean civil-service exam questions into curriculum units.

Chunk file (read it): ${chunksDir}/${file}
It contains: "subject", "allowed_tags" (the ONLY permitted tags), and "questions"
(each with question_id, question_text, keyword_title, correct_choice_summary).

Steps:
1. Read the chunk file.
2. Classify EVERY question into exactly ONE tag from allowed_tags. Rules:
   - Copy the tag string verbatim from allowed_tags — never invent/abbreviate/modify.
   - Choose by what the question actually tests (the legal issue / era / topic / skill).
   - "기타" is a last resort, not a default: use it only when no other tag genuinely fits.
   - Every question_id appears exactly once, no duplicates.
3. Write the result JSON array to ${chunksDir}/result-${file}
   Format: [{"question_id":"...","unit_tag":"..."}, ...]  (no markdown, no code fence)
4. Run this shell command to save+validate (it re-checks every tag against the
   subject's allowed list and rejects bad ones individually):
   node --env-file=${envPath} ${repoDir}/scripts/save-unit-tags.mjs ${chunksDir}/result-${file}
   The command prints JSON: {"saved_count": N, "rejected": [...]}.
5. If saved_count is 0 or rejected is non-empty, re-read the offending questions,
   fix ONLY those tags in the result file, and re-run the save command once more.

Return the final saved_count as "saved" and the final rejected array length as
"rejected". Put any anomaly (e.g. save errors) in "note".`,
      { label: file.replace('.json', ''), phase: 'Tag', model: 'sonnet', schema: RESULT_SCHEMA },
    ),
)

const clean = results.filter(Boolean)
const totalSaved = clean.reduce((a, r) => a + (r.saved || 0), 0)
const totalRejected = clean.reduce((a, r) => a + (r.rejected || 0), 0)
const failedChunks = clean.filter((r) => !r.saved).map((r) => r.file)
const missing = files.length - clean.length

log(`태깅 완료: ${totalSaved} 저장, ${totalRejected} 거부, 청크실패 ${failedChunks.length}, 에이전트유실 ${missing}`)

return {
  total_saved: totalSaved,
  total_rejected: totalRejected,
  chunks_processed: clean.length,
  chunks_missing_agent: missing,
  failed_chunks: failedChunks,
  notes: clean.filter((r) => r.note).map((r) => ({ file: r.file, note: r.note })),
}
