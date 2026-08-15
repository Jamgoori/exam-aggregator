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
| 복습 스케줄(SRS) 상수 조정 (`packages/core/src/srs.ts`, 학습 단계·ease·leech·연체 점수) | `docs/agents/srs-tuning.md` |
| 개념 사전 정리 (`keyword_title` 정본화, `concepts`/`concept_aliases`, 약점 진단 축, 재분류 배치 `next-concept-chunk.mjs`/`save-concepts.mjs`) | `docs/agents/concept-dictionary.md` |
| 해외 IP 차단 (`geo-block.ts`, `proxy.ts`, `GEO_BLOCK*` 환경변수, 크롤러 예외) | `docs/agents/geo-block.md` |

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
- **SRS 상수**: 실측(`npm run retention-report`) 없이 간격·ease·leech 상수를 바꾸지
  말 것. 바꿀 때는 `packages/core/src/srs.ts`와 `supabase/functions/_shared/srs.ts`를
  반드시 함께 고칠 것 (한쪽만 고치면 웹과 앱의 복습일이 조용히 어긋난다).
- **개념 사전**: `keyword_title` 원본을 UPDATE 하지 말 것 (화면에 그대로 보여주는
  값 — 정리 결과는 `concept_id` 축으로만). 개념 id 재발급 금지, 삭제 대신
  `merged_into`. 미매칭을 "기타"로 뭉치지 말 것.
  `normalizeConceptAlias` 는 세 곳에 있다 (루틴 환경은 plain node라 TypeScript
  패키지를 import 못 한다): `packages/core/src/concept-dictionary.ts`(원본),
  `apps/web/scripts/save-explanations.mjs`(해설 배치),
  `apps/web/scripts/lib/concept-alias.mjs`(재분류 배치) — **반드시 함께 고칠 것**.
  하나만 고치면 경로에 따라 같은 문항에 다른 개념이 붙는다.
  재분류 배치는 이미 붙은 `concept_id`를 덮어쓰지 말 것 (재실행 시 개념이 흔들리면
  진단 이력이 깨진다).
- **해외 IP 차단**: 크롤러 예외(`CRAWLER_UA`)를 좁히지 말 것 — Googlebot·Bingbot 은
  미국 IP 에서 오므로, 예외가 빠지면 403 이 계속 나가 색인이 통째로 사라진다.
  `/payments/**`·`/auth/**`·`/api/**` 를 차단 대상에 넣지 말 것 (결제 승인
  리다이렉트를 막으면 돈만 빠진 주문이 남는다). 국가를 모를 때는 언제나 통과시킬 것.
- **정답 등록**: `question_count`와 길이가 다른 정답 배열을 덮어쓰지 말 것.
  공통과목이라고 정답을 다른 직류(track) 문제지에 수동 복사하지 말 것 (법원직
  서기보는 국어·한국사 15문항/영어 20문항 별도 문제지 — 실측 사고 있음).
  전항정답/복수정답/정답없음은 `voided_questions`로 처리.
