-- Run this in the Supabase SQL editor (Project > SQL Editor > New query).
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT everywhere.

create extension if not exists "pgcrypto";

-- 과목 (국어, 영어, 한국사, 행정법 ...)
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,          -- e.g. "korean", "english", "korean-history"
  name text not null,                 -- e.g. "국어"
  display_order int not null default 0
);

-- 시험 직렬 (국가직, 지방직, 서울시, 경찰, 소방, 해경, 국회직, 법원직 ...) - 급수는 exam_papers.level에 따로 저장
create table if not exists exam_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  display_order int not null default 0
);

alter table exam_types add column if not exists display_order int not null default 0;

-- 실제 업로드되는 기출문제 PDF 한 건 = 특정 연도/시험/과목의 문제지
create table if not exists exam_papers (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete restrict,
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  year int not null,
  round int not null default 1,       -- 같은 해 여러 회차가 있는 경우 대비 (경찰직 1차/2차 등)
  level text,                         -- 급수, e.g. "9급", "7급"
  title text not null,                -- e.g. "2024 국가직 9급 국어"
  question_count int,                 -- 문항 수 (선택 입력)
  tags text[] not null default '{}',  -- e.g. {"문법", "비문학"}
  file_path text not null,            -- Supabase Storage 내 경로
  file_name text not null,
  file_size bigint,                   -- bytes
  view_count int not null default 0,
  download_count int not null default 0,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

-- 기존 설치본에 컬럼이 없다면 추가 (스키마를 먼저 만든 적이 있는 경우 대비)
alter table exam_papers add column if not exists level text;
alter table exam_papers add column if not exists question_count int;
alter table exam_papers add column if not exists tags text[] not null default '{}';
alter table exam_papers add column if not exists file_size bigint;
alter table exam_papers add column if not exists view_count int not null default 0;
alter table exam_papers add column if not exists download_count int not null default 0;
-- 같은 연도/급수를 공유하는 특수모집 분야 구분용 (예: "근로감독 및 산업안전분야"). 일반 채용은 null.
alter table exam_papers add column if not exists track text;

create index if not exists exam_papers_subject_idx on exam_papers(subject_id);
create index if not exists exam_papers_exam_type_idx on exam_papers(exam_type_id);
create index if not exists exam_papers_year_idx on exam_papers(year desc);

-- 관리자 화이트리스트: 일반 회원가입을 열면 "로그인한 사용자면 다 admin" 가정이
-- 깨지므로, 이 테이블에 등록된 이메일만 exam_papers를 쓸 수 있게 한다.
create table if not exists admins (
  email text primary key
);

alter table admins enable row level security;
-- admins 테이블 자체는 아무도 클라이언트에서 직접 못 읽음 (is_admin() 함수로만 검사)

create or replace function is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from admins where email = auth.jwt()->>'email'
  );
$$;

grant execute on function is_admin() to anon, authenticated;

-- 댓글 (회원/비회원 모두 작성 가능). auth.users는 공개 API로 조인이 안 되므로
-- nickname을 작성 시점에 그대로 저장해둔다 (회원이면 서버에서 user_metadata.nickname을 읽어 채움).
-- 비회원 댓글은 password_hash(bcrypt)로 수정/삭제 권한을 확인한다.
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  nickname text not null,
  content text not null,
  password_hash text,                 -- 비회원 댓글만 사용 (bcrypt 해시)
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table comments add column if not exists password_hash text;
alter table comments add column if not exists updated_at timestamptz;

-- 길이 제한 (닉네임 10자, 내용 1~2000자) — DB 레벨에서도 강제
do $$ begin
  alter table comments add constraint comments_nickname_len
    check (char_length(nickname) between 1 and 10);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table comments add constraint comments_content_len
    check (char_length(content) between 1 and 2000);
exception when duplicate_object then null; end $$;

create index if not exists comments_paper_idx on comments(paper_id, created_at);

-- 난이도 평가 (회원/비회원 모두, 문제지당 1회로 제한)
create table if not exists difficulty_ratings (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_token text,
  score smallint not null check (score between 1 and 5),
  created_at timestamptz not null default now(),
  constraint difficulty_ratings_voter_check
    check (
      (user_id is not null and guest_token is null) or
      (user_id is null and guest_token is not null)
    )
);

create unique index if not exists difficulty_ratings_user_unique
  on difficulty_ratings(paper_id, user_id) where user_id is not null;
create unique index if not exists difficulty_ratings_guest_unique
  on difficulty_ratings(paper_id, guest_token) where guest_token is not null;

-- 정답지: 과목별이 아니라 "그 시험(연도+직렬+급수+회차) 전체"에 1개만 업로드해서
-- 해당 조건에 맞는 모든 exam_papers 상세페이지에서 공유해서 보여준다.
create table if not exists answer_keys (
  id uuid primary key default gen_random_uuid(),
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  year int not null,
  level text,
  round int not null default 1,
  track text,          -- 특수모집 분야 구분용 (exam_papers.track과 동일한 의미). 일반 채용은 null.
  file_path text not null,
  file_name text not null,
  file_size bigint,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique nulls not distinct (exam_type_id, year, level, round, track)
);

-- 기존 설치본 대비: track 컬럼 추가 + 기존 4컬럼 unique 제약을 track 포함 5컬럼으로 교체
alter table answer_keys add column if not exists track text;

do $$
declare
  cons_name text;
begin
  select conname into cons_name
  from pg_constraint
  where conrelid = 'answer_keys'::regclass
    and contype = 'u'
    and conkey = (
      select array_agg(attnum order by attnum)
      from pg_attribute
      where attrelid = 'answer_keys'::regclass
        and attname in ('exam_type_id', 'year', 'level', 'round')
    );
  if cons_name is not null then
    execute format('alter table answer_keys drop constraint %I', cons_name);
  end if;
end $$;

alter table answer_keys drop constraint if exists answer_keys_unique_key;
alter table answer_keys add constraint answer_keys_unique_key
  unique nulls not distinct (exam_type_id, year, level, round, track);

-- RLS
alter table subjects enable row level security;
alter table exam_types enable row level security;
alter table exam_papers enable row level security;
alter table comments enable row level security;
alter table difficulty_ratings enable row level security;
alter table answer_keys enable row level security;

-- 누구나 읽기 가능 (공개 사이트)
drop policy if exists "public read subjects" on subjects;
create policy "public read subjects" on subjects for select using (true);

drop policy if exists "public read exam_types" on exam_types;
create policy "public read exam_types" on exam_types for select using (true);

drop policy if exists "public read exam_papers" on exam_papers;
create policy "public read exam_papers" on exam_papers for select using (true);

-- admins 테이블에 등록된 이메일만 exam_papers를 쓸 수 있음 (일반 회원과 분리)
drop policy if exists "authenticated insert exam_papers" on exam_papers;
drop policy if exists "admin insert exam_papers" on exam_papers;
create policy "admin insert exam_papers" on exam_papers
  for insert to authenticated with check (is_admin());

drop policy if exists "authenticated update exam_papers" on exam_papers;
drop policy if exists "admin update exam_papers" on exam_papers;
create policy "admin update exam_papers" on exam_papers
  for update to authenticated using (is_admin());

drop policy if exists "authenticated delete exam_papers" on exam_papers;
drop policy if exists "admin delete exam_papers" on exam_papers;
create policy "admin delete exam_papers" on exam_papers
  for delete to authenticated using (is_admin());

-- 정답지: 누구나 읽기, 관리자만 쓰기
drop policy if exists "public read answer_keys" on answer_keys;
create policy "public read answer_keys" on answer_keys for select using (true);

drop policy if exists "admin insert answer_keys" on answer_keys;
create policy "admin insert answer_keys" on answer_keys
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update answer_keys" on answer_keys;
create policy "admin update answer_keys" on answer_keys
  for update to authenticated using (is_admin());

drop policy if exists "admin delete answer_keys" on answer_keys;
create policy "admin delete answer_keys" on answer_keys
  for delete to authenticated using (is_admin());

-- 댓글: 누구나 읽기(단 password_hash는 절대 노출 안 됨). 쓰기(insert/update/delete)는
-- 전부 서버 액션(service_role)에서 비밀번호/세션 검증 후 수행하므로, anon/authenticated에는
-- 쓰기 권한을 주지 않고 select도 컬럼 단위로 제한한다.
drop policy if exists "public read comments" on comments;
create policy "public read comments" on comments for select using (true);

drop policy if exists "insert own comments" on comments;
drop policy if exists "delete own or admin comments" on comments;

-- password_hash 컬럼이 공개 API로 새어나가지 않도록 컬럼 단위 권한으로 제한
revoke all on comments from anon, authenticated;
grant select (id, paper_id, user_id, nickname, content, created_at, updated_at)
  on comments to anon, authenticated;

-- 난이도 평가: 누구나 읽기, 본인 명의로만 작성 (문제지당 1회는 unique index로 강제)
drop policy if exists "public read ratings" on difficulty_ratings;
create policy "public read ratings" on difficulty_ratings for select using (true);

drop policy if exists "insert own rating" on difficulty_ratings;
create policy "insert own rating" on difficulty_ratings
  for insert to anon, authenticated
  with check (
    (auth.uid() is not null and user_id = auth.uid() and guest_token is null) or
    (auth.uid() is null and user_id is null and guest_token is not null)
  );

-- 다운로드 수 증가용 함수: 익명 사용자가 다운로드 카운트만 안전하게 올릴 수 있도록
-- security definer로 만들고, 테이블 UPDATE 권한은 별도로 열어주지 않는다.
create or replace function increment_download_count(paper_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update exam_papers set download_count = download_count + 1 where id = paper_id;
$$;

grant execute on function increment_download_count(uuid) to anon, authenticated;

-- 초기 과목 데이터 (필요에 맞게 추가/수정하세요)
insert into subjects (slug, name, display_order) values
  ('korean', '국어', 1),
  ('english', '영어', 2),
  ('korean-history', '한국사', 3),
  ('administrative-law', '행정법총론', 4),
  ('administration', '행정학개론', 5),
  ('constitution', '헌법', 6),
  ('criminal-law', '형법', 7)
on conflict (slug) do nothing;

-- 기존에 급수가 이름에 포함된 형태("국가직 9급")로 넣었던 경우 정리
update exam_types set name = '국가직' where name = '국가직 9급';
update exam_types set name = '지방직' where name = '지방직 9급';
update exam_types set name = '서울시' where name = '서울시 9급';
-- 예전에 "경찰직"으로 넣었던 경우 "경찰"로 정리
update exam_types set name = '경찰' where name = '경찰직';

insert into exam_types (name, display_order) values
  ('국가직', 1),
  ('지방직', 2),
  ('서울시', 3),
  ('경찰', 4),
  ('소방', 5),
  ('해경', 6),
  ('국회직', 7),
  ('법원직', 8),
  ('기상직', 9),
  ('지역인재', 10),
  ('계리직', 11),
  ('간호직', 12)
on conflict (name) do update set display_order = excluded.display_order;

-- 관리자 이메일 (본인 계정으로 바꿔서 실행하세요)
insert into admins (email) values ('lks2354@gmail.com')
on conflict (email) do nothing;
