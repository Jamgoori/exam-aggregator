-- 공지사항 댓글. Supabase SQL Editor 에서 1회 실행(재실행 안전).
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다.
--
-- 원글(notices)과 반대로 읽기는 완전히 공개, 쓰기는 로그인 회원만 가능하다.
create table if not exists notice_comments (
  id uuid primary key default gen_random_uuid(),
  notice_id uuid not null references notices(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

do $$ begin
  alter table notice_comments add constraint notice_comments_content_len
    check (char_length(content) between 1 and 1000);
exception when duplicate_object then null; end $$;

create index if not exists notice_comments_notice_idx
  on notice_comments(notice_id, created_at);
create index if not exists notice_comments_user_idx
  on notice_comments(user_id, created_at desc);

alter table notice_comments enable row level security;

drop policy if exists "public read notice_comments" on notice_comments;
create policy "public read notice_comments" on notice_comments
  for select using (true);

drop policy if exists "insert own notice_comments" on notice_comments;
create policy "insert own notice_comments" on notice_comments
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "update own notice_comments" on notice_comments;
create policy "update own notice_comments" on notice_comments
  for update to authenticated using (auth.uid() = user_id);

drop policy if exists "delete own or admin notice_comments" on notice_comments;
create policy "delete own or admin notice_comments" on notice_comments
  for delete to authenticated using (auth.uid() = user_id or is_admin());
