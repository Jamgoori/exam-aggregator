-- "찍었어요" 표시 (2026-07-30)
--
-- 맞혔지만 사용자가 찍었다고 표시한 문항. 4지선다는 모르고도 25%가 맞는데, 그걸
-- 유지력으로 인정하면 모르는 문항이 "아는 문제"로 분류돼 복습 큐에서 빠져나간다.
-- 표시하면 점수·극복 판정은 그대로 두고 srs_due_at 만 몇 시간 뒤로 되돌린다
-- (packages/core/src/srs.ts 의 srsGuessed).
--
-- 채점 후 결과 화면에서만 눌린다. 쓰기는 서버 액션이 service_role 로 하며
-- review_session_items 는 RLS 정책이 0개라 클라이언트가 직접 못 고친다.
--
-- 적용: Supabase SQL Editor에서 실행. 기존 행은 default false 로 채워진다.

alter table review_session_items add column if not exists guessed boolean not null default false;
