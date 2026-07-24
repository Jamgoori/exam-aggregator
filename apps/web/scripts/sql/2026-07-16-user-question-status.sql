-- 문항 단위 통합 상태(user_question_status) 신설 + 기존 응시 데이터 백필
-- 실행: Supabase SQL Editor (service role). additive라 안전하고, 백필은
-- on conflict do nothing이라 여러 번 돌려도 중복 삽입되지 않는다.
-- schema.sql에도 테이블/RLS 정의가 반영돼 있다(새 환경 재현용). 이 파일은 운영 DB에
-- 바로 적용하기 위한 실행본이며, 백필 INSERT는 여기(1회성)에만 있다.
--
-- 배경: 오답노트 "극복" 판정과 앞으로 나올 섞어풀기(오답 재풀이)가 공유할 문항×사용자
-- 요약 테이블. cbt_attempt_answers는 응시별 원본이라 문항 단위 상태를 매번 재계산해야
-- 하고, 문제지 단위가 아닌 섞어풀기 결과는 그 파생만으로 표현이 안 된다.
--
-- 키는 questions.id가 아니라 (paper_id, question_number) — 채점 원본이 이 쌍으로
-- 기록되고, 크롭 전 문제지도 CBT를 지원하므로 questions.id 의존을 피한다.

begin;

create table if not exists user_question_status (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  wrong_count int not null default 0,
  last_is_correct boolean not null,
  last_answered_at timestamptz not null default now(),
  source text not null default 'cbt',
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id, question_number)
);

create index if not exists user_question_status_user_idx
  on user_question_status(user_id);

alter table user_question_status enable row level security;

drop policy if exists "select own question status" on user_question_status;
create policy "select own question status" on user_question_status
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own question status" on user_question_status;
create policy "insert own question status" on user_question_status
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own question status" on user_question_status;
create policy "update own question status" on user_question_status
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 백필: 기존 응시 전체에서 (user, paper, question_number)별로 집계.
--   wrong_count       = 틀린 채로 제출된 횟수(cbt_attempt_answers 한 행 = 제출 1회)
--   last_is_correct   = 가장 최근 제출의 정오
--   last_answered_at  = 가장 최근 제출 시각
-- 앱의 증분 갱신(제출 1회당 오답이면 +1)과 같은 의미가 되도록 맞췄다.
insert into user_question_status (
  user_id, paper_id, question_number,
  wrong_count, last_is_correct, last_answered_at, source, updated_at
)
select
  a.user_id,
  a.paper_id,
  ans.question_number,
  count(*) filter (where ans.is_correct = false) as wrong_count,
  (array_agg(ans.is_correct order by a.created_at desc))[1] as last_is_correct,
  max(a.created_at) as last_answered_at,
  'cbt' as source,
  now() as updated_at
from cbt_attempt_answers ans
join cbt_attempts a on a.id = ans.attempt_id
group by a.user_id, a.paper_id, ans.question_number
on conflict (user_id, paper_id, question_number) do nothing;

commit;
