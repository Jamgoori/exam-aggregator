-- 오답노트 문항 마크(다시 볼 문제 체크 + 완전 삭제)
-- 실행: Supabase SQL Editor (service role). additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용). 백필 없음.
--
-- pinned  = 오답 중 꼭 다시 볼 문제로 체크한 것 (문항 카드 우측 토글).
-- deleted = 오답노트에서 완전히 제외한 것 (실수로 틀렸거나 지엽 문항).
--           응시 원본(cbt_attempt_answers)은 점수 기록과 전국 오답률 집계에 쓰이므로
--           지우지 않고, 오답노트 조회·집계·섞어풀기 후보에서만 걸러낸다.

begin;

create table if not exists wrong_note_marks (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  pinned boolean not null default false,
  deleted boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, paper_id, question_number)
);

create index if not exists wrong_note_marks_user_idx on wrong_note_marks(user_id);

alter table wrong_note_marks enable row level security;

drop policy if exists "select own wrong note marks" on wrong_note_marks;
create policy "select own wrong note marks" on wrong_note_marks
  for select to authenticated using (auth.uid() = user_id);
drop policy if exists "insert own wrong note marks" on wrong_note_marks;
create policy "insert own wrong note marks" on wrong_note_marks
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "update own wrong note marks" on wrong_note_marks;
create policy "update own wrong note marks" on wrong_note_marks
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "delete own wrong note marks" on wrong_note_marks;
create policy "delete own wrong note marks" on wrong_note_marks
  for delete to authenticated using (auth.uid() = user_id);

commit;
