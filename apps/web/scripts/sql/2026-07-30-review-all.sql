-- 복습(간격 반복) 고도화 — 배포 전 한 번에 적용 (2026-07-30)
--
-- 같은 날 만든 마이그레이션 4개를 순서대로 합쳐 둔 것이다. 개별 파일과 내용이 같고
-- 전부 idempotent(if not exists)라 여러 번 실행해도 안전하다.
--
--   2026-07-30-srs-pending-pool.sql
--   2026-07-30-review-daily-limit.sql
--   2026-07-30-review-guessed.sql
--   2026-07-30-srs-leech.sql
--
-- ⚠ 반드시 배포보다 먼저 실행할 것. 새 코드는 srs_suspended_at·daily_limit·guessed 를
-- 조회 조건으로 쓰므로, 컬럼이 없는 상태로 배포되면 복습 큐 조회가 전부 실패해
-- 유료 사용자에게 "오늘 복습할 문항 없어요"만 뜬다(에러도 안 보인다).
--
-- 전부 추가만 한다. 기존 데이터는 바뀌지 않는다.

-- 1) 대기 풀 조회용 인덱스. 새 오답은 즉시 SRS에 태우지 않고
--    "wrong_count > 0 이면서 srs_due_at is null" 상태로 쌓이며, 복습 세션을 시작할 때
--    하루 신규 몫만큼만 승격된다. 승격 순서(자주 틀린 것 먼저)대로 상위 몇백 행만
--    읽어야 해서 정렬을 DB에 맡긴다.
create index if not exists user_question_status_pending_idx
  on user_question_status(user_id, wrong_count desc, last_answered_at)
  where srs_due_at is null;

-- 2) 하루에 낼 복습 문항 수(10/20/40/60 중 선택, 기본 20). 값 검증은 서버에서 한다.
alter table review_preferences add column if not exists daily_limit int not null default 20;

-- 3) "찍었어요" 표시. 점수·극복 판정은 그대로 두고 복습 스케줄만 되돌린다.
alter table review_session_items add column if not exists guessed boolean not null default false;

-- 4) leech(여덟 번 넘게 무너진 문항) 접어두기. null 이면 정상.
--    기존 행에는 소급 적용하지 않는다 — 다음에 또 틀릴 때 판정에 걸린다.
alter table user_question_status add column if not exists srs_suspended_at timestamptz;
