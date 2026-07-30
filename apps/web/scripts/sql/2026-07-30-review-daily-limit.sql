-- 복습 하루 문항 수 설정 (2026-07-30)
--
-- 기본 20. 시험이 가까우면 40·60으로 올리고, 여유가 없으면 10으로 줄인다.
-- 고를 수 있는 값은 DAILY_LIMIT_OPTIONS(packages/core/src/review-queue.ts)로 제한하고
-- 검증은 setDailyLimit(apps/web/src/lib/review-preferences.ts)에서 한다 — 임의의 수를
-- 허용하면 "하루 1문항" 설정으로 스케줄이 사실상 정지한다.
--
-- 하루 신규 몫은 이 값에 비례한다(20 → 10, 40 → 20). 총량만 늘리고 신규를 고정하면
-- 대기 풀이 줄어드는 속도가 안 바뀌어서 사용자가 상한을 올린 의도를 배신한다.
--
-- 적용: Supabase SQL Editor에서 실행. 기존 행은 default 20으로 채워진다.

alter table review_preferences add column if not exists daily_limit int not null default 20;
