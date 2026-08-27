-- 채팅방(오픈카카오톡 대체). Supabase SQL Editor 에서 1회 실행(재실행 안전).
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다.
--
-- 읽기는 댓글처럼 누구나 가능하지만(눈팅하다 로그인해서 참여하도록), 쓰기는 전부
-- 서버 액션(service_role)이 로그인·비속어·도배(짧은 간격 연속 전송, 같은 내용
-- 반복)를 검사한 뒤에만 한다 — comments 와 같은 이유로 anon/authenticated 에는
-- 쓰기 권한을 아예 주지 않는다.
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 작성 시점 닉네임을 그대로 박아둔다(comments 와 같은 이유 — auth.users 는 공개
  -- API 로 조인이 안 되고, 나중에 닉네임을 바꿔도 과거 메시지 표기는 그대로 남는다).
  nickname text not null,
  content text not null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table chat_messages add constraint chat_messages_nickname_len
    check (char_length(nickname) between 1 and 10);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table chat_messages add constraint chat_messages_content_len
    check (char_length(content) between 1 and 300);
exception when duplicate_object then null; end $$;

-- 채팅창은 항상 최신 N개를 시간순으로 읽는다.
create index if not exists chat_messages_created_idx on chat_messages(created_at desc);
-- 도배 방지(직전 메시지 시각·내용 대조, 최근 전송 빈도 집계)용 — 사용자별 최신 메시지 조회.
create index if not exists chat_messages_user_idx on chat_messages(user_id, created_at desc);

alter table chat_messages enable row level security;

drop policy if exists "public read chat_messages" on chat_messages;
create policy "public read chat_messages" on chat_messages for select using (true);

revoke all on chat_messages from anon, authenticated;
grant select on chat_messages to anon, authenticated;

-- 실시간 구독: 새 메시지가 새로고침 없이 다른 참여자 화면에 바로 반영되게 한다.
do $$ begin
  alter publication supabase_realtime add table chat_messages;
exception when duplicate_object then null; end $$;
