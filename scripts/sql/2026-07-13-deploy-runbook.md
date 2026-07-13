# 법령 해설 배포 런북 (2026-07-13)

계정 소유자가 직접 연 세션에서 이 파일을 읽고 그대로 실행하기 위한 런북이다.
배경: 법령 문항 해설을 "현행법 기준 본문 + 출제 당시 별도 표기" 방식으로 전환한다.
전략·파일은 이 브랜치(claude/legal-problem-explanation-update-svoq8h)에 준비돼 있고,
AGENTS.md의 "문항 해설 배치 루틴" 절이 배경 지식이다.

## 현재 상태 (2026-07-13 05:00 UTC 카나리아 진단 기준)

- ✅ DB 마이그레이션 완료 — `question_explanations`에 `current_answer_status`/
  `current_answer_note`/`law_basis_date` 컬럼이 이미 존재한다 (재실행 불필요.
  혹시 없으면 `scripts/sql/2026-07-12-law-explanation-migration.sql` 실행 — idempotent).
- ❌ Storage의 `explanation-prompt.md`는 아직 구버전 ("original_note" 문자열 없음).
- ❌ 백업 테이블 `question_explanations_backup_20260712` 없음 = 기존 법 해설 삭제 미실행.
- ⏸️ 해설 배치 루틴 2개(순방향/역방향)는 꺼져 있음 — 오케스트레이터 세션이 배포 확인
  후 다시 켠다. **이 세션에서 루틴을 켜거나 끄지 말 것.**

## 실행할 것 (순서 엄수)

### 1. Storage 스크립트 교체 (exam-papers 버킷, service role 필요)

이 레포 워킹트리의 파일을 Storage의 **같은 경로**에 upsert한다 (경로는 버킷을 list해서
기존 파일 위치로 확인):

1. `scripts/save-explanations.mjs` **먼저** 업로드.
2. `scripts/explanation-prompt.md` 다음에 업로드.
   (순서 이유: 신프롬프트+구save 조합은 현행법 필드를 조용히 유실시키지만, 반대 조합은 무해.)
3. 각각 재다운로드해서 로컬 파일과 diff — 완전 일치해야 통과.
4. `next-explanation-chunk.mjs`는 절대 수정/업로드하지 말 것.

### 2. 미니 검증 (실전 파이프라인으로 1건)

1. `node scripts/next-explanation-chunk.mjs`로 청크 하나를 받는다.
2. 법령 문항 1개를 골라 (없으면 비법령 문항으로 저장 경로만 검증하고 그렇게 기록)
   신프롬프트 규칙대로 해설 JSON을 작성, `node scripts/save-explanations.mjs <파일>`로 저장.
3. 그 행을 다시 select해서 `law_basis_date`와 `choice_explanations` 안의
   `current_status`/`original_note`가 실제로 저장됐는지 확인. 이 행은 정상 산출물이므로 둔다.

### 3. 기존 법 해설 백업 후 삭제

`scripts/sql/2026-07-12-delete-law-explanations.sql`을 STEP 순서대로:

1. STEP 1 — 삭제 대상 건수 조회 (기록).
2. STEP 2 — 백업 테이블 생성, 건수가 STEP 1과 일치하는지 확인. **불일치하면 중단.**
3. STEP 3 — 비매칭 표본 감사 (법 해설이 새는 패턴이 보이면 기록만 하고 진행 가능).
4. STEP 4 — 삭제. **백업 건수 확인 전에는 절대 실행 금지.**
5. 2번에서 방금 저장한 신형 해설이 함께 지워져도 무방 (루틴이 재생성).

SQL 실행 수단: 이 환경에서 이전 세션이 마이그레이션(DDL)에 성공했으므로 수단이 존재한다
(SUPABASE_DB_URL + psql/node-postgres, 또는 Management API 등). 환경변수를 확인해 같은
방법을 쓰면 된다. select/insert/delete는 service role로 PostgREST를 써도 된다
(단, CREATE TABLE AS인 STEP 2는 SQL 실행 수단 필요).

### 4. 결과 보고

마지막 메시지에 요약: 각 단계 성공 여부, STEP별 건수(대상/백업/삭제), 미니 검증에 쓴
question_id, 사용한 SQL 수단, 시각(UTC). 가능하면 이 파일 옆에
`2026-07-13-law-deploy-report.md`로 결과를 남겨 커밋·푸시해도 좋다 (이 세션은
소유자가 직접 연 세션이라 푸시 권한 문제가 없을 것).

## 하지 말 것

- `question_explanations_question_uidx` 인덱스, RLS, admins, `explanation_excluded_subjects` 변경 금지.
- 루틴 트리거/크론 변경 금지 (오케스트레이터가 관리).
- 대량 해설 생성 금지 (정규 루틴 몫).
