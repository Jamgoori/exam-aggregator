-- AI 약점 진단에서 뺄 과목 목록. Supabase SQL Editor 에서 1회 실행(재실행 안전).
--
-- 맞춤 극복법은 개념 하나당 실API 생성이 붙어서 요금이 개념 수에 비례한다. 그래서
-- 과목당 상위 7개, 전체 20개까지만 만드는데, 준비하지 않는 과목이 그 20자리를 차지하면
-- 정작 필요한 과목이 얕아진다. 사용자가 직접 뺄 수 있게 하려는 컬럼이다.
--
-- 복습 보류(paused_subject_ids)와 컬럼을 나눈 이유: 복습을 쉬는 과목이라고 진단까지
-- 빼고 싶은 건 아니고, 반대도 마찬가지다.
alter table review_preferences
  add column if not exists diagnosis_paused_subject_ids uuid[] not null default '{}';
