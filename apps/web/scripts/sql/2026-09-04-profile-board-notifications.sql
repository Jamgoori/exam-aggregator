-- 프로필 사진 · 자유게시판 · 알림 (2026-09-04)
--
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다(운영 DB 에 1회 적용용).
-- Supabase 대시보드 → SQL Editor 에 붙여 넣어 실행한다. 전부 멱등이라 여러 번
-- 돌려도 안전하다.
--
-- 스토리지 버킷(avatars · board-images)까지 여기서 만든다 — 대시보드에서 손으로
-- 만들면 public 여부·용량 상한·허용 MIME 이 환경마다 달라진다.

-- ── 프로필 사진 (avatars) ───────────────────────────────────────────────────
-- 이미지는 Storage 의 avatars 버킷(공개 읽기)에 두고, 여기에는 경로만 적는다.
-- 닉네임과 같은 이중 기록이다 — 화면에 뿌리는 값의 원본은
-- auth.users.raw_user_meta_data.avatar_path 이고(헤더가 JWT 만 읽고 그린다),
-- 이 컬럼은 다른 사람의 아바타를 서버가 한 번에 모아 읽을 때 쓴다(게시판 목록·댓글).
-- auth.users 는 공개 API 로 직접 조회가 안 되므로 profiles 가 그 창구다.
alter table profiles add column if not exists avatar_path text;

-- 버킷은 코드가 만들지 않는다 — 대시보드에서 만들어도 되지만, 새 환경을 이 파일
-- 하나로 재현할 수 있어야 해서 여기 둔다. public=true 라 사진은 서명 없이 그대로
-- <img src> 에 붙는다(프로필 사진은 어차피 댓글마다 공개로 노출되는 값이다).
-- 쓰기 정책은 아래에서 열지 않는다: 업로드는 전부 서버 액션이 service_role 로
-- 수행하며(리사이즈·확장자 정규화를 서버가 강제해야 한다), 클라이언트가 버킷에
-- 직접 올릴 수 있으면 그 강제가 통째로 우회된다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars', 'avatars', true, 5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read avatars" on storage.objects;
create policy "public read avatars" on storage.objects
  for select using (bucket_id = 'avatars');

-- 게시판 본문에 삽입하는 이미지. 아바타와 같은 이유로 공개 읽기 + 서버 업로드다.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'board-images', 'board-images', true, 10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read board images" on storage.objects;
create policy "public read board images" on storage.objects
  for select using (bucket_id = 'board-images');

-- ── 자유게시판 (board_posts) ────────────────────────────────────────────────
-- 회원끼리 이야기하는 일반 커뮤니티 게시판. 건의게시판(suggestions)과 달리
-- 비밀글이 없어 읽기는 완전히 공개다(notices 와 같은 RLS 구성).
--
-- 본문이 평문이 아니라 **서식 있는 HTML**(content_html)이다. 굵게·색·정렬·이미지가
-- 들어간다. 그래서 저장 경로에 두 가지 규칙이 붙는다:
--   1. 서버 액션이 packages/core/src/rich-text.ts 의 sanitizeRichText 를 통과시킨
--      결과만 넣는다. 화면은 이 값을 dangerouslySetInnerHTML 로 그리므로, 이 규칙이
--      깨지는 순간 저장형 XSS 가 된다. **클라이언트가 보낸 HTML 을 그대로 넣지 말 것.**
--   2. content_text 는 같은 본문의 평문 사본이다. 목록 미리보기·검색·비속어 검사가
--      쓴다(HTML 을 그대로 검사하면 글자 사이에 <b></b> 하나로 다 빠져나간다).
create table if not exists board_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 작성 시점 닉네임 스냅샷 (suggestions·comments 와 같은 이유).
  nickname text not null,
  -- 말머리. 값 목록은 packages/core/src/board.ts 의 BOARD_CATEGORIES 가 정본이다.
  category text not null default 'free',
  title text not null,
  content_html text not null,
  content_text text not null,
  -- 목록 카드 썸네일 = 본문 첫 이미지. 매번 HTML 을 파싱하지 않으려고 뽑아 둔다.
  thumbnail_url text,
  view_count int not null default 0,
  -- 아래 두 값은 트리거가 유지한다(목록에서 글마다 count 쿼리를 돌리지 않으려는 것).
  comment_count int not null default 0,
  like_count int not null default 0,
  is_pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

do $$ begin
  alter table board_posts add constraint board_posts_title_len
    check (char_length(title) between 1 and 100);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table board_posts add constraint board_posts_content_len
    check (char_length(content_html) between 1 and 30000);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table board_posts add constraint board_posts_category_check
    check (category in ('free', 'question', 'info', 'review'));
exception when duplicate_object then null; end $$;

-- 목록은 최신순 한 페이지씩. 말머리 탭이 있으므로 category 를 앞에 둔 인덱스도 둔다.
create index if not exists board_posts_created_idx on board_posts(created_at desc);
create index if not exists board_posts_category_idx on board_posts(category, created_at desc);
create index if not exists board_posts_pinned_idx on board_posts(created_at desc) where is_pinned;
-- 도배 방지(시간당 작성 수)·내 글 모아보기 조회용.
create index if not exists board_posts_user_idx on board_posts(user_id, created_at desc);

alter table board_posts enable row level security;

-- 누구나 읽기 가능 (공개 게시판 — notices 와 같다).
drop policy if exists "public read board_posts" on board_posts;
create policy "public read board_posts" on board_posts for select using (true);

-- 쓰기 정책은 열지 않는다. 본문 HTML 은 반드시 서버의 새니타이저를 거쳐야 하는데,
-- insert 정책을 열어주면 REST 로 직접 넣는 경로가 그 관문을 그냥 지나간다.
-- (읽기만 공개, 쓰기는 service_role = 서버 액션 전용.)
revoke insert, update, delete on board_posts from anon, authenticated;

-- 조회수 +1. 공개 게시판이라 anon 도 부를 수 있다(notices 와 같은 처리).
create or replace function increment_board_view(p_post_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update board_posts set view_count = view_count + 1 where id = p_post_id;
$$;

grant execute on function increment_board_view(uuid) to anon, authenticated;

-- ── 게시판 댓글 ─────────────────────────────────────────────────────────────
-- 답글은 1단계까지만 (parent_id 가 있는 댓글에는 다시 답글을 달 수 없다 —
-- 서버 액션이 부모를 원 댓글로 접어 올린다: core 의 resolveBoardCommentParent).
--
-- is_deleted: 답글이 달린 댓글을 통째로 지우면 그 아래 답글이 맥락을 잃는다. 그래서
-- 지운 표시만 남기고 "삭제된 댓글입니다"로 그린다. 답글이 없으면 서버가 행을 실제로
-- 지운다(그 편이 목록이 깔끔하다).
create table if not exists board_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references board_posts(id) on delete cascade,
  parent_id uuid references board_comments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null,
  content text not null,
  is_deleted boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

do $$ begin
  alter table board_comments add constraint board_comments_content_len
    check (char_length(content) between 1 and 1000);
exception when duplicate_object then null; end $$;

create index if not exists board_comments_post_idx on board_comments(post_id, created_at);
create index if not exists board_comments_parent_idx on board_comments(parent_id, created_at);
create index if not exists board_comments_user_idx on board_comments(user_id, created_at desc);

alter table board_comments enable row level security;

drop policy if exists "public read board_comments" on board_comments;
create policy "public read board_comments" on board_comments for select using (true);

revoke insert, update, delete on board_comments from anon, authenticated;

-- ── 게시판 좋아요 ───────────────────────────────────────────────────────────
-- 한 사람이 한 글에 한 번. 기본키가 그 규칙 자체다(중복 클릭은 upsert 로 흡수).
create table if not exists board_post_likes (
  post_id uuid not null references board_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists board_post_likes_user_idx on board_post_likes(user_id, created_at desc);

alter table board_post_likes enable row level security;

-- 누가 눌렀는지는 공개 정보가 아니지만(목록에 이름을 띄우지 않는다), 본인 것은
-- 읽을 수 있어야 "내가 이미 눌렀는지"를 판단한다. 개수는 board_posts.like_count 로 본다.
drop policy if exists "select own board_post_likes" on board_post_likes;
create policy "select own board_post_likes" on board_post_likes
  for select to authenticated using (auth.uid() = user_id);

revoke insert, update, delete on board_post_likes from anon, authenticated;

-- ── 집계 컬럼 유지 트리거 ───────────────────────────────────────────────────
-- 목록에서 글마다 count(*) 를 도는 대신 board_posts 에 세어 둔 값을 읽는다.
-- 증감이 아니라 매번 다시 세는 이유: 증감식은 한 번이라도 어긋나면 영영 어긋난 채로
-- 남는다(음수 댓글 수). 게시판 하나의 댓글 수를 세는 건 인덱스 한 번이라 싸다.
create or replace function sync_board_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.post_id, old.post_id);
begin
  update board_posts
     set comment_count = (
       select count(*) from board_comments
        where post_id = target and is_deleted = false
     )
   where id = target;
  return null;
end;
$$;

drop trigger if exists board_comments_count_trigger on board_comments;
create trigger board_comments_count_trigger
after insert or update or delete on board_comments
for each row execute function sync_board_comment_count();

create or replace function sync_board_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target uuid := coalesce(new.post_id, old.post_id);
begin
  update board_posts
     set like_count = (select count(*) from board_post_likes where post_id = target)
   where id = target;
  return null;
end;
$$;

drop trigger if exists board_post_likes_count_trigger on board_post_likes;
create trigger board_post_likes_count_trigger
after insert or delete on board_post_likes
for each row execute function sync_board_like_count();

-- ── 알림 (notifications) ────────────────────────────────────────────────────
-- "내 글에 댓글이 달렸다 / 내 댓글에 답글이 달렸다"를 알려주는 최소한의 알림.
--
-- 행을 만드는 건 트리거가 아니라 그 사건이 일어난 서버 액션이다. 트리거로 하면
-- "누가 눌렀는지"(actor)와 "어디로 보내야 하는지"(link)를 DB 가 다시 조립해야 하는데,
-- 그 정보는 이미 액션이 손에 들고 있다. 대신 액션은 알림 생성 실패를 삼킨다 —
-- 알림이 안 만들어졌다고 댓글 등록이 실패하면 본말이 전도된다.
--
-- title/preview/link 를 join 하지 않고 박아두는 이유: 원글이 지워져도 알림 목록이
-- 깨지지 않아야 하고(그때는 링크만 404 가 된다), 목록 조회가 게시판 테이블을 다시
-- 훑지 않아야 한다.
create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  -- 받는 사람.
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 종류. 값 목록은 packages/core/src/notifications.ts 의 NOTIFICATION_TYPES 가 정본.
  type text not null,
  -- 알림을 일으킨 사람. 탈퇴하면 null 이 되지만 닉네임 스냅샷은 남는다.
  actor_id uuid references auth.users(id) on delete set null,
  actor_nickname text not null,
  title text not null,
  preview text not null default '',
  link text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table notifications add constraint notifications_type_check
    check (type in (
      'board_comment', 'board_reply',
      'suggestion_comment', 'suggestion_answer'
    ));
exception when duplicate_object then null; end $$;

-- 목록은 언제나 "내 알림을 최신순으로". 안 읽은 개수는 부분 인덱스로 센다.
create index if not exists notifications_user_idx on notifications(user_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications(user_id) where read_at is null;

alter table notifications enable row level security;

-- 본인 것만 읽는다. 쓰기(만들기·읽음 처리·삭제)는 전부 서버 액션(service_role)이
-- 한다 — 읽음 처리까지 클라이언트에 열어주면 update 정책이 컬럼을 가리지 못해
-- 자기 알림의 link·title 을 REST 로 아무 값으로나 바꿔둘 수 있다(자기 화면에서만
-- 보이는 값이라 남에게 새지는 않지만, 열어둘 이유가 없다).
drop policy if exists "select own notifications" on notifications;
create policy "select own notifications" on notifications
  for select to authenticated using (auth.uid() = user_id);

-- 예전 적용본에 있던 쓰기 정책은 지운다.
drop policy if exists "update own notifications" on notifications;
drop policy if exists "delete own notifications" on notifications;

revoke insert, update, delete on notifications from anon, authenticated;
