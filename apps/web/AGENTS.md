<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# 작업별 상세 규칙은 docs/agents/ — 해당 작업 시작 전 반드시 Read

이 파일은 "절대 어기면 안 되는 금지선"만 담은 인덱스다. 아래 표의 작업에 손대기
전에 **대응 문서를 Read 도구로 먼저 읽을 것** — 각 문서는 실제 사고를 겪고 쓴
절차·원인·복구 방법이라, 안 읽고 작업하면 같은 사고가 재발한다.

| 작업 | 먼저 읽을 문서 |
|---|---|
| 문항 이미지 크롭 (`crop-question-images.mjs`/`batch-crop-questions.mjs`, 새 시험유형 등록 포함) | `docs/agents/crop-question-images.md` |
| 해설 배치 루틴·해설 스크립트·해설 관련 RLS/스키마 (`next-explanation-chunk.mjs`, `save-explanations.mjs`, 루틴 프롬프트/훅) | `docs/agents/explanation-batch-routines.md` |
| 법령 문항 해설 (생성·재생성·삭제·판별) | `docs/agents/law-explanations.md` |
| 중복 시험지 표시 통합 (`dedup-papers.ts`, 목록에 같은 시험지가 여러 장 보이는 문제) | `docs/agents/dedup-papers.md` |
| 정답 등록·검수 (`extract-answer-keys.mjs`, `list-pending-answer-keys.mjs`, `paper_answers` 직접 조작) | `docs/agents/answer-keys-tracks.md` |
| 통합본 PDF 과목별 분리 (`split-by-toc.mjs`/`split-combined-pdf.mjs`/`split-by-subject-header.mjs`) | `docs/agents/split-combined-pdfs.md` |

# 금지선 (문서 안 읽었어도 이것만은 절대)

- **크롭**: 배치 스크립트를 한 번 돌리고 성공/실패 개수만 보고 끝내지 말 것.
  "개수 일치 = 성공"으로 판단 금지 (반쪽 크롭이 개수만 맞은 실측 사례 있음).
  크롭 로직 수정 시 이미 완료한 다른 시험유형/급수 전체 재검증 필수.
- **해설 배치**: 레포의 `scripts/` 해설 스크립트 사본을 Supabase Storage에 업로드
  금지 (배포는 소유자 전용 절차). `question_explanations_question_uidx` unique
  인덱스 삭제 금지 (upsert 전제조건). `question_explanations` RLS/`admins` 변경 시
  해설봇 계정 쓰기 권한 유지 확인 필수. 제외 과목은
  `explanation_excluded_subjects` 테이블로만 제어 — 스크립트 수정 아님.
- **법령 해설**: 정답 번호는 언제나 출제 당시 공식 정답 유지 (현행법 반영은
  `current_answer_status` 등 메타로만). 법 문항 판별을 keyword 정규식으로 하지
  말 것.
- **dedup**: 목록의 카드 병합은 버그가 아님 — 표시 로직을 되돌리거나 중복으로
  보이는 `exam_papers` 행을 삭제하지 말 것.
- **정답 등록**: `question_count`와 길이가 다른 정답 배열을 덮어쓰지 말 것.
  공통과목이라고 정답을 다른 직류(track) 문제지에 수동 복사하지 말 것 (법원직
  서기보는 국어·한국사 15문항/영어 20문항 별도 문제지 — 실측 사고 있음).
  전항정답/복수정답/정답없음은 `voided_questions`로 처리.
