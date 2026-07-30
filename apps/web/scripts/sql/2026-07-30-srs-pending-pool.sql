-- 복습 대기 풀 인덱스 (2026-07-30)
--
-- 새 오답은 더 이상 즉시 SRS에 태우지 않는다. "wrong_count > 0 이면서 srs_due_at is
-- null" 인 행이 대기 풀이고, 복습 세션을 시작할 때 하루 신규 몫(NEW_QUEUE_LIMIT)
-- 만큼만 승격한다. 별도 컬럼을 두지 않는 이유는 채점 경로가 스케줄 없는 문항에 due를
-- 심지 않게 되면서 이 조합 자체가 곧 대기 상태가 되기 때문이다
-- (apps/web/src/lib/question-status.ts).
--
-- 1회독 중인 사용자는 대기가 수백 개까지 쌓인다. 승격 순서(자주 틀린 것 먼저, 같으면
-- 오래 안 본 것 먼저)대로 상위 몇백 행만 읽어야 해서 정렬을 DB에 맡긴다 —
-- 기존 user_question_status_due_idx 는 srs_due_at is not null 부분 인덱스라
-- 대기 행을 전혀 못 덮는다.
--
-- 적용: Supabase SQL Editor에서 실행. 기존 사용자의 이미 예약된 문항은 그대로
-- 두므로(백로그 파산은 별도 작업) 데이터 변경 없이 인덱스만 추가한다.

create index if not exists user_question_status_pending_idx
  on user_question_status(user_id, wrong_count desc, last_answered_at)
  where srs_due_at is null;
