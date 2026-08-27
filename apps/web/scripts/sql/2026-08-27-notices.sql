-- 공지사항 게시판. Supabase SQL Editor 에서 1회 실행(재실행 안전).
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다.
--
-- 운영자가 전체 이용자에게 알리는 글. suggestions(건의게시판)와 달리 비밀글·
-- 댓글·답변 개념이 없고, 읽기는 완전히 공개(exam_papers와 같은 방식)라
-- service_role을 거치지 않고 anon/authenticated가 직접 select 할 수 있다.
-- 쓰기(작성/수정/삭제)는 admins 화이트리스트(is_admin())만 가능하다.
create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  is_pinned boolean not null default false,
  view_count int not null default 0,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

do $$ begin
  alter table notices add constraint notices_title_len
    check (char_length(title) between 1 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table notices add constraint notices_content_len
    check (char_length(content) between 1 and 5000);
exception when duplicate_object then null; end $$;

create index if not exists notices_created_idx on notices(created_at desc);
create index if not exists notices_pinned_idx on notices(created_at desc) where is_pinned;

alter table notices enable row level security;

drop policy if exists "public read notices" on notices;
create policy "public read notices" on notices for select using (true);

drop policy if exists "admin insert notices" on notices;
create policy "admin insert notices" on notices
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update notices" on notices;
create policy "admin update notices" on notices
  for update to authenticated using (is_admin());

drop policy if exists "admin delete notices" on notices;
create policy "admin delete notices" on notices
  for delete to authenticated using (is_admin());

create or replace function increment_notice_view(p_notice_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update notices set view_count = view_count + 1 where id = p_notice_id;
$$;

grant execute on function increment_notice_view(uuid) to anon, authenticated;
