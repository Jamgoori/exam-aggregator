-- 복습 이력 로그 테이블 (2026-08-04)
--
-- user_question_status 는 "지금 상태"만 들고 있어서, 배정한 간격에서 실제로 몇 %가
-- 맞았는지를 셀 수 없었다. 그래서 ease 2.5·1·3일 학습 단계·연체 점수 상한 14일이
-- 맞는 값인지 확인할 방법이 없다. 간격 반복은 상수를 실측으로 조정해야 쓸 만해지는
-- 알고리즘이라, 이 로그가 없으면 영원히 추측으로 남는다.
--
-- 배포와 순서를 가리지 않는다 — 새 코드는 이 테이블에 넣기만 하고 아무것도 읽지
-- 않으며, insert 실패는 조용히 무시된다(채점을 막지 않는다). 다만 없는 동안의
-- 채점은 기록이 남지 않으므로 먼저 적용하는 편이 낫다.
--
-- 추가만 한다. 기존 데이터는 바뀌지 않는다.

create table if not exists srs_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  reviewed_at timestamptz not null default now(),
  is_correct boolean not null,
  -- 'cbt'(문제지 응시) | 'review'(섞어풀기·복습 세션)
  source text not null default 'cbt',
  -- 채점 직전 상태 = 이 복습이 검증한 대상
  prev_interval_days int not null,
  prev_ease real not null,
  prev_reps int not null,
  prev_lapses int not null,
  -- 직전 채점 이후 실제 경과일(예정일에 제때 봤다면 prev_interval_days 와 같다)
  elapsed_days int,
  -- 채점 후 새로 배정된 간격
  next_interval_days int not null
);

create index if not exists srs_reviews_user_idx on srs_reviews(user_id, reviewed_at);
create index if not exists srs_reviews_interval_idx on srs_reviews(prev_interval_days);

alter table srs_reviews enable row level security;

drop policy if exists "select own srs reviews" on srs_reviews;
create policy "select own srs reviews" on srs_reviews
  for select to authenticated using (auth.uid() = user_id);

-- 쓰기 정책 없음: 이 로그로 알고리즘 상수를 조정할 거라 클라이언트가 행을 넣을 수
-- 있으면 그 근거가 오염된다. 쓰기는 서버 채점 경로(service_role)만 한다.
drop policy if exists "insert own srs reviews" on srs_reviews;

-- 적용 후 확인용 — 며칠 뒤부터 이 쿼리가 알고리즘 튜닝의 근거가 된다.
-- 간격 구간별 실제 유지율(목표는 85~90%):
--
--   select
--     width_bucket(prev_interval_days, 1, 180, 12) as bucket,
--     min(prev_interval_days) as from_days,
--     max(prev_interval_days) as to_days,
--     count(*) as reviews,
--     round(100.0 * avg(case when is_correct then 1 else 0 end), 1) as retention
--   from srs_reviews
--   where prev_interval_days > 0
--     and elapsed_days >= prev_interval_days  -- 예정일에 제대로 본 것만
--   group by 1 order by 1;
