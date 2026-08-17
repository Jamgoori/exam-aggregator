-- 문항 오류 신고 (2026-08-17)
--
-- 해설(explanation)이나 CBT 응시(cbt) 화면에서 "이 문항 이상해요"를 눌러 접수하는
-- 신고. question_memos/wrong_note_marks 와 같은 이유로 questions.id가 아니라
-- (paper_id, question_number)로 문항을 가리킨다 — 화면들이 이미 그 조합으로 문항을
-- 다루고 있어 questions 조회를 한 번 더 하지 않아도 된다.
--
-- 같은 사람이 같은 문항에 같은 화면으로 여러 번 눌러도(더블클릭 등) 처리 대기열에
-- 중복이 쌓이지 않게, "미해결" 신고 하나로 묶는다(difficulty_ratings의 투표 1인
-- 1표 유니크 인덱스와 같은 방식). status가 바뀌면(해결됨) 다시 신고할 수 있어야
-- 하므로 컬럼 자체가 아니라 부분 인덱스(where status = 'open')로 제한한다.
--
-- 이 파일의 내용은 schema.sql 에도 그대로 반영돼 있다(schema.sql이 정본).

create table if not exists question_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  context text not null check (context in ('explanation', 'cbt')),
  reason text not null check (reason in ('wrong_answer', 'wrong_explanation', 'image_issue', 'other')),
  message text check (char_length(message) <= 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists question_reports_paper_idx on question_reports(paper_id, question_number);
create index if not exists question_reports_open_idx on question_reports(status, created_at desc) where status = 'open';

create unique index if not exists question_reports_open_unique
  on question_reports(user_id, paper_id, question_number, context)
  where status = 'open';

alter table question_reports enable row level security;

drop policy if exists "select own question_reports" on question_reports;
create policy "select own question_reports" on question_reports
  for select to authenticated using (auth.uid() = user_id or is_admin());
drop policy if exists "insert own question_reports" on question_reports;
create policy "insert own question_reports" on question_reports
  for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "admin update question_reports" on question_reports;
create policy "admin update question_reports" on question_reports
  for update to authenticated using (is_admin());
