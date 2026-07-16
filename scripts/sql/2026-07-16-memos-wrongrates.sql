-- 문항 메모 테이블 + 전국 오답률 집계 함수
-- 실행: Supabase SQL Editor (service role). additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용). 백필 없음.

begin;

-- 1) 문항 메모(오답노트 문항별 개인 메모). 본인만 읽고 쓴다.
create table if not exists question_memos (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  memo text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id, question_number)
);

alter table question_memos enable row level security;

drop policy if exists "select own memos" on question_memos;
create policy "select own memos" on question_memos
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own memos" on question_memos;
create policy "insert own memos" on question_memos
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own memos" on question_memos;
create policy "update own memos" on question_memos
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own memos" on question_memos;
create policy "delete own memos" on question_memos
  for delete to authenticated using (auth.uid() = user_id);

-- 2) 전국 오답률 집계. cbt_attempt_answers는 본인만 select 가능하므로 security definer로
--    전체를 집계한다. 반환은 오답 "비율"뿐(정답 아님) — 정답 유출이 아니다.
create or replace function paper_question_wrong_rates(p_paper_ids uuid[])
returns table(paper_id uuid, question_number int, attempts bigint, wrongs bigint)
language sql
stable
security definer
set search_path = public
as $$
  select a.paper_id, ans.question_number,
         count(*) as attempts,
         count(*) filter (where ans.is_correct = false) as wrongs
  from cbt_attempt_answers ans
  join cbt_attempts a on a.id = ans.attempt_id
  where a.paper_id = any(p_paper_ids)
  group by a.paper_id, ans.question_number
$$;

grant execute on function paper_question_wrong_rates(uuid[]) to authenticated;

commit;
