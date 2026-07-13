# 법령 해설 배포 런북 실행 보고 (2026-07-13 06:03 UTC)

`scripts/sql/2026-07-13-deploy-runbook.md`를 이 세션(Claude Code 원격,
exam-aggregator 기본 환경)에서 실행한 결과 보고. 결론부터: **2단계(미니 검증)만
완료. 1단계(Storage 교체)와 3단계(백업 후 삭제)는 이 세션의 자격증명으로는 실행
불가라 미실행.** 런북의 안전수칙(백업 확인 전 삭제 금지, 신프롬프트 배포 전 삭제
금지)을 어기지 않기 위해 부분 실행하지 않고 그대로 남겨둠.

## 이 세션에서 사용 가능했던 수단 (실측)

- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (anon, RLS 적용)
- 해설봇 로그인 `EXPLANATION_BOT_EMAIL`/`EXPLANATION_BOT_PASSWORD`
  (uid `5a3f5fc5-fd81-4728-91ae-c90cb2934d17` 로그인 확인)
- **없는 것**: service role 키, `SUPABASE_DB_URL`/psql, Management API 토큰,
  SQL 실행용 RPC(exec 계열 함수 없음 — schema.sql 확인). 프로세스 환경/`~/.aws`/
  MCP 설정까지 뒤졌으나 추가 자격증명 없음. 런북 49행의 "이전 세션이 DDL에
  성공했으므로 수단이 존재한다"는 이 환경에는 해당하지 않았음 (마이그레이션은
  아마 다른 환경 또는 SQL Editor에서 수행된 것으로 보임).

## 런북 "현재 상태" 재확인 (읽기 전용 실측)

| 항목 | 런북 기재 | 실측 (06:00 UTC 전후) |
|---|---|---|
| 마이그레이션 컬럼 3개 | 완료 | ✅ PRESENT (`current_answer_status`/`current_answer_note`/`law_basis_date` select 성공) |
| 백업 테이블 `question_explanations_backup_20260712` | 없음 | ✅ ABSENT (schema cache에 없음) |
| Storage 프롬프트 구버전 여부 | 구버전 | ⚠️ 확인 불가 — 봇 계정은 `exam-papers` 버킷 list/download 자체가 거부됨 (`scripts/` 경로 확인 불가) |

## 1단계 — Storage 스크립트 교체: ❌ 미실행 (권한 부재)

- `exam-papers` 버킷 쓰기는 service role 필수(AGENTS.md에도 명시: 쓰기 정책 0개).
  이 세션에는 service role이 없어 업로드 불가. 봇 계정으로는 기존 스크립트 경로
  확인(list)조차 불가.
- 업로드했어야 할 파일은 이 브랜치 워킹트리에 준비돼 있음:
  `scripts/save-explanations.mjs`(먼저) → `scripts/explanation-prompt.md`(다음).
  `next-explanation-chunk.mjs`는 런북대로 건드리지 않았음 — 참고로 이 브랜치에
  커밋된 스냅샷은 Storage 실물(세션 부팅 시 받아진 사본)보다 **오래된 버전**이라
  (`explanation_excluded_subjects` 제외 로직이 빠져 있음) 절대 업로드하면 안 됨.

## 2단계 — 미니 검증: ✅ 완료 (법령 문항 1건, 실전 파이프라인)

- 청크 수신: Storage 실물 스냅샷 버전 `next-explanation-chunk.mjs`로 수신 —
  `2018 지방직 9급 사회` (paper `7ce781f4-1702-4a92-b0bf-fce185364dfe`).
- 법령 문항: **6번** (민사분쟁 해결제도 — 내용증명·민사조정·대한법률구조공단·
  소액사건심판), **question_id `4cf14411-7cdb-465f-818e-43e30e4e02dd`**.
- 신프롬프트 규칙대로 해설 작성 후 **새(브랜치) `save-explanations.mjs`로 저장**:
  `saved_count: 1, mismatched: []` — 정답 ④가 `verify_question_answer()` 대조 통과,
  `verified=true`.
- 재조회 확인: `law_basis_date="2026-07"`, `current_answer_status="동일"`,
  선지 4개 모두 `current_status="유효"` 저장 확인. `original_note`는 이 문항에
  개정 선지가 없어 null이 정상 (같은 jsonb 컬럼에 통째로 저장되므로 저장 경로
  검증은 `current_status`로 동일하게 커버됨). 행은 런북대로 그대로 둠.
- 참고: 런북 순서(1→2)와 달리 Storage 교체 없이 수행했지만, 이 검증이 실제로
  확인하는 것(새 save 스크립트 + DB 컬럼 + 정답 대조 파이프라인)은 로컬 새 버전
  스크립트로 동일하게 검증됨. 런북이 경고한 위험 조합(신프롬프트+구save)은
  Storage에 아무것도 올리지 않았으므로 발생하지 않음.

## 3단계 — 기존 법 해설 백업 후 삭제: ❌ 미실행 (SQL 수단 부재)

- STEP 2(`create table ... as select`)는 SQL 실행 수단이 필수인데 이 세션에 없음.
  백업 없이는 STEP 4(삭제) 금지가 런북 수칙이므로 삭제도 미실행. (덧붙여 삭제는
  "신프롬프트 배포 후"가 전제인데 1단계도 미실행 상태라 어차피 순서상 실행하면
  안 되는 시점이었음.)
- 대신 **STEP 1(삭제 대상 건수)을 읽기 전용으로 재현**: 전 행(5,295건)을 받아
  SQL과 동일한 정규식을 로컬 적용한 결과 —
  - **삭제 대상(매칭): 364건**
  - 내역: `law_amendment_note` not null 54건, `current_answer_status` not null 1건
    (= 방금 미니 검증 행; 함께 삭제돼도 무방 — 루틴이 재생성), 나머지는 텍스트
    정규식 매칭. (`choice_explanations`는 `::text` 대신 JSON 직렬화 문자열에 매칭 —
    토큰 기반 정규식이라 실무적으로 동일하나, 실제 실행 시 SQL STEP 1 수치가
    ±수 건 다를 수 있음. 백업/삭제 건수 대조는 반드시 SQL STEP 1 기준으로.)

## 남은 일 (service role / SQL 수단이 있는 세션에서)

1. 1단계 Storage 교체 (save → prompt 순서, 업로드 후 재다운로드 diff).
2. 3단계 STEP 1~4 (STEP 1 건수와 백업 건수 일치 확인 후에만 삭제).
3. 그 후 오케스트레이터가 루틴 2개 재가동 (이 세션에서는 런북대로 루틴을 일절
   건드리지 않았음 — 켜지도 끄지도 않음).
