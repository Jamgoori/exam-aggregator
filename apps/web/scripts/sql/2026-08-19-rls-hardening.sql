-- 사용자 직접 쓰기 경로 조이기 (2026-08-19) — 보안 점검 후속
--
-- 이 파일의 내용은 schema.sql 에도 그대로 반영돼 있다(schema.sql 이 정본). 전부 멱등이라
-- 다시 돌려도 무방하다.
--
-- 공통 원인 하나: **검사는 애플리케이션에만 있고 RLS 는 `auth.uid() = user_id` 만 본다.**
-- Supabase 는 anon 키와 사용자 JWT 만 있으면 PostgREST 를 직접 부를 수 있으므로, 서버
-- 액션·Edge Function 안에 있는 검사(멤버십·시간당 한도·길이 제한)는 화면을 거치지 않는
-- 요청에는 한 번도 평가되지 않는다. 이 앱은 memberships·payments·user_question_status
-- 처럼 값이 곧 권한인 테이블은 이미 "쓰기 정책 없음 + service_role 로만 쓰기"로 정리해
-- 두었는데, 아래 두 테이블만 그 정리에서 빠져 있었다.

-- ── 1. ai_diagnoses: 요청 행 생성을 service_role 로 옮긴다 ────────────────────
--
-- AI 약점 진단은 유료 기능이다. 그런데 페이월은 애플리케이션에만 있었다
-- (웹 requestDiagnosis 의 isPremium, 앱 ai-diagnose 의 isPremiumUser). INSERT 정책은
-- `auth.uid() = user_id and report is null` 뿐이라 멤버십도 자격(오답 15개/응시 3회)도
-- 보지 않는다.
--
-- 그래서 무료 계정이 PostgREST 로 요청 행을 직접 만들면:
--   POST /rest/v1/ai_diagnoses  {"user_id":"<내 uid>","diagnosis_date":"…","report":null}
-- 리포트를 채우는 배치(scripts/next-diagnosis.mjs)가 `report is null` 인 가장 오래된 행을
-- 멤버십 확인 없이 집어다 Claude 로 채워 준다. 그 뒤 select-own 정책으로 그대로 읽힌다 —
-- 결제도 자격도 없이 유료 리포트를 받아가는 경로다. diagnosis_date 에 제약이 없어 날짜만
-- 바꿔 수백 행을 밀어 넣으면 생성 대기열을 통째로 점유할 수도 있다(유니크는
-- (user_id, diagnosis_date) 뿐).
--
-- 요청 행 생성도 다른 유료 경로와 같이 service_role 전용으로 옮긴다. 웹은
-- lib/ai-diagnosis.ts 의 requestTodayDiagnosis 가, 앱은 Edge Function 이 만든다 —
-- 둘 다 멤버십을 먼저 확인한 뒤에 만든다.
--
-- select 정책은 그대로 둔다(본인 리포트는 클라이언트가 직접 읽는다). 그래서 테이블
-- 권한을 통째로 revoke 하지 않고 insert 만 회수한다.
drop policy if exists "insert own diagnosis request" on ai_diagnoses;
revoke insert on ai_diagnoses from anon, authenticated;

-- ── 2. question_reports: 접수를 service_role 로 옮긴다 ────────────────────────
--
-- 신고는 관리자 처리 대기열로 직행하는 사용자 입력이다. 서버 액션(submitQuestionReport)
-- 은 시간당 20건 상한과 문항 번호 상한(300)을 확인하지만, 정작 INSERT 는 사용자 세션
-- 클라이언트로 나가고 RLS 는 `auth.uid() = user_id` 만 본다. PostgREST 를 직접 부르면
-- 두 상한 모두 평가되지 않는다 — PostgREST 는 배열 본문으로 한 요청에 수천 행을 넣을 수
-- 있어서, 계정 하나로 미해결 신고를 대량 생성해 /admin/reports 를 못 쓰게 만들 수 있다
-- (유니크 부분 인덱스는 (user_id, paper_id, question_number, context) 조합마다 1건씩
-- 허용하므로 문항 번호만 바꾸면 사실상 무제한이다).
--
-- select 정책은 그대로 둔다(본인 신고 조회 + 관리자 화면). insert 만 회수한다.
drop policy if exists "insert own question_reports" on question_reports;
revoke insert on question_reports from anon, authenticated;

-- 문항 번호 상한을 DB 에도 건다. 서버 액션의 REPORT_QUESTION_NUMBER_MAX 와 같은 값 —
-- 실제 문제지에 이만큼 나올 일은 없고, 터무니없는 값으로 의미 없는 행이 쌓이는 것만 막는
-- 느슨한 상한이다. (기존 행에 범위 밖 값이 있으면 제약 추가가 실패하므로 먼저 정리한다.)
delete from question_reports where question_number < 1 or question_number > 300;
do $$ begin
  alter table question_reports add constraint question_reports_qnum_range
    check (question_number between 1 and 300);
exception when duplicate_object then null; end $$;

-- ── 3. question_memos / wrong_note_marks: 값 범위를 DB 에도 건다 ──────────────
--
-- 이 둘은 위와 달리 클라이언트 직접 쓰기를 유지한다 — 웹과 앱이 모두 사용자 세션
-- 클라이언트로 upsert 하고, 담기는 값이 개인 메모·표시 플래그라 값 자체가 권한이 되지
-- 않는다. 다만 길이·범위 제한이 애플리케이션에만 있어서(웹은 slice(0, 2000), 앱은
-- 자르지도 않는다) PostgREST 직접 호출로 그냥 우회된다.
--
-- comments(1~2000자)·suggestions(제목 100 / 본문 2000)·question_reports.message(500)에는
-- 이미 DB 제약이 있는데 자유 텍스트인 memo 에만 없었다. 기본키가
-- (user_id, paper_id, question_number) 이고 문항 번호에 범위 제약도 없어서, 계정 하나로
-- 수 MB 짜리 행을 사실상 무한히 만들어 DB 용량과 백업 비용을 밀어 올릴 수 있었다.
delete from question_memos where question_number < 1 or question_number > 300;
update question_memos set memo = left(memo, 2000) where char_length(memo) > 2000;
delete from question_memos where char_length(memo) = 0;

do $$ begin
  alter table question_memos add constraint question_memos_memo_len
    check (char_length(memo) between 1 and 2000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table question_memos add constraint question_memos_qnum_range
    check (question_number between 1 and 300);
exception when duplicate_object then null; end $$;

delete from wrong_note_marks where question_number < 1 or question_number > 300;
do $$ begin
  alter table wrong_note_marks add constraint wrong_note_marks_qnum_range
    check (question_number between 1 and 300);
exception when duplicate_object then null; end $$;
