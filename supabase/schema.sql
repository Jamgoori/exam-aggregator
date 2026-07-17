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
-- 선지 수. 대부분 4지선다지만 경찰/소방 등 일부 직렬은 5지선다라 CBT 화면에서
-- 몇 번까지 버튼을 보여줄지 이 값으로 결정한다. 정답이 아니라 형식 정보라 공개해도 무방.
alter table exam_papers add column if not exists choice_count smallint not null default 4;

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
  ip_address text,                    -- 비회원 댓글 도배 방지용 rate-limit 조회에 사용
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table comments add column if not exists password_hash text;
alter table comments add column if not exists updated_at timestamptz;
alter table comments add column if not exists ip_address text;
-- 답글: null이면 최상위 댓글, 아니면 그 댓글에 달린 답글. 대댓글의 대댓글까지는 허용하지
-- 않고(서버 액션에서 parent_id가 최상위 댓글인지 검증), 1단계 깊이로만 제한한다.
alter table comments add column if not exists parent_id uuid references comments(id) on delete cascade;

create index if not exists comments_parent_idx on comments(parent_id) where parent_id is not null;

create index if not exists comments_guest_rate_limit_idx
  on comments(ip_address, created_at desc)
  where user_id is null and ip_address is not null;

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

-- 난이도 평가 (회원/비회원 모두, 문제지당 1회로 제한). 0.5 단위 입력을 허용하기 위해
-- score를 smallint가 아니라 numeric(2,1)로 저장한다.
create table if not exists difficulty_ratings (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  guest_token text,
  score numeric(2,1) not null check (score in (1,1.5,2,2.5,3,3.5,4,4.5,5)),
  created_at timestamptz not null default now(),
  constraint difficulty_ratings_voter_check
    check (
      (user_id is not null and guest_token is null) or
      (user_id is null and guest_token is not null)
    )
);

-- 기존 설치본 대비: score를 smallint(1~5 정수)에서 numeric(2,1)(0.5 단위)로 변경.
-- 이미 numeric(2,1)인 설치본에서 다시 실행해도 동일 타입으로의 캐스팅이라 안전하다.
alter table difficulty_ratings alter column score type numeric(2,1) using score::numeric(2,1);

alter table difficulty_ratings drop constraint if exists difficulty_ratings_score_check;
alter table difficulty_ratings add constraint difficulty_ratings_score_check
  check (score in (1,1.5,2,2.5,3,3.5,4,4.5,5));

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
grant select (id, paper_id, user_id, nickname, content, created_at, updated_at, parent_id)
  on comments to anon, authenticated;

-- 난이도 평가: 누구나 읽기, 로그인한 본인 명의로만 작성 가능 (비회원 평가는 막음).
-- 문제지당 1회는 unique index로 강제.
drop policy if exists "public read ratings" on difficulty_ratings;
create policy "public read ratings" on difficulty_ratings for select using (true);

drop policy if exists "insert own rating" on difficulty_ratings;
create policy "insert own rating" on difficulty_ratings
  for insert to authenticated
  with check (auth.uid() = user_id and guest_token is null);

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

-- 홈 화면 "누적 다운로드" 집계용: exam_papers가 많아져도 전체 행을 클라이언트로
-- 내려받지 않고 DB에서 합계만 계산해서 반환한다.
create or replace function total_download_count()
returns bigint
language sql
stable
as $$
  select coalesce(sum(download_count), 0) from exam_papers;
$$;

grant execute on function total_download_count() to anon, authenticated;

-- 마이페이지 즐겨찾기: 회원이 문제지를 찜해두고 나중에 다시 찾아볼 수 있게 한다.
-- (추후 CBT 채점 결과/오답노트/시험별 점수도 마이페이지에 같이 들어갈 예정이라
--  회원 전용 개인화 데이터는 이 테이블처럼 user_id 기준 RLS로 분리해서 쌓아간다.)
create table if not exists bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, paper_id)
);

create index if not exists bookmarks_user_idx on bookmarks(user_id, created_at desc);

alter table bookmarks enable row level security;

drop policy if exists "select own bookmarks" on bookmarks;
create policy "select own bookmarks" on bookmarks
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own bookmarks" on bookmarks;
create policy "insert own bookmarks" on bookmarks
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "delete own bookmarks" on bookmarks;
create policy "delete own bookmarks" on bookmarks
  for delete to authenticated using (auth.uid() = user_id);

-- 과목 즐겨찾기: 공시생은 보통 본인이 응시하는 과목 몇 개만 반복해서 보므로, 문제지
-- 단위 북마크(bookmarks)와 별개로 "관심 과목" 자체를 저장해 /bookmarks에서 그 과목들의
-- 문제지만 모아 볼 수 있게 한다.
create table if not exists subject_bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid not null references subjects(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, subject_id)
);

create index if not exists subject_bookmarks_user_idx on subject_bookmarks(user_id, created_at desc);

alter table subject_bookmarks enable row level security;

drop policy if exists "select own subject bookmarks" on subject_bookmarks;
create policy "select own subject bookmarks" on subject_bookmarks
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists "insert own subject bookmarks" on subject_bookmarks;
create policy "insert own subject bookmarks" on subject_bookmarks
  for insert to authenticated with check (auth.uid() = user_id);

drop policy if exists "delete own subject bookmarks" on subject_bookmarks;
create policy "delete own subject bookmarks" on subject_bookmarks
  for delete to authenticated using (auth.uid() = user_id);

-- CBT 자동채점용 문항별 정답 배열. 기존 answer_keys(직렬+연도+급수+회차 전체가 공유하는
-- 정답지 PDF)와 달리, exam_papers(과목별 문제지) 1건당 정답 배열 1건을 구조화된 값으로
-- 저장한다. 문항 본문/보기까지 디지털화하기 전에도 채점만은 가능하게 하려는 임시 구조이고,
-- 나중에 문항단위 테이블이 생기면 (paper_id, question_number)로 그대로 조인할 수 있다.
-- 정답이 그대로 노출되면 채점 의미가 없으므로 anon/authenticated에는 select도 주지 않고
-- (서버 액션에서 service_role로만 읽어 채점), 관리자 화면만 is_admin()으로 읽고 쓴다.
create table if not exists paper_answers (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null unique references exam_papers(id) on delete cascade,
  answers smallint[] not null,
  updated_at timestamptz not null default now()
);

-- 전항정답/복수정답 처리된 문제 번호. 전체 회차 CBT에서는 원본 그대로 노출하되 이 번호는
-- 무조건 정답 처리하고, 기출 섞어풀기에서는 이 번호를 후보에서 제외하는 데 쓴다.
alter table paper_answers add column if not exists voided_questions smallint[] not null default '{}';

alter table paper_answers enable row level security;

drop policy if exists "admin read paper_answers" on paper_answers;
create policy "admin read paper_answers" on paper_answers
  for select to authenticated using (is_admin());

drop policy if exists "admin insert paper_answers" on paper_answers;
create policy "admin insert paper_answers" on paper_answers
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update paper_answers" on paper_answers;
create policy "admin update paper_answers" on paper_answers
  for update to authenticated using (is_admin());

drop policy if exists "admin delete paper_answers" on paper_answers;
create policy "admin delete paper_answers" on paper_answers
  for delete to authenticated using (is_admin());

-- CBT 풀이 화면에서 "이 문제지가 CBT를 지원하는지"만 확인할 수 있게 하는 함수.
-- paper_answers는 정답이 들어있어 anon/authenticated select를 아예 안 열어뒀으므로,
-- 정답 내용은 노출하지 않고 존재 여부만 security definer로 안전하게 알려준다.
create or replace function has_cbt_answers(target_paper_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (select 1 from paper_answers where paper_id = target_paper_id);
$$;

grant execute on function has_cbt_answers(uuid) to anon, authenticated;

-- 문제지 목록(홈/과목별/즐겨찾기/같은 과목 목록) 카드에서 "바로 풀기" 버튼을 보여줄지
-- 한 번에 판단하기 위한 배치 버전. 화면에 보이는 문제지 id들만 넘겨 그중 CBT 정답이
-- 있는 것만 돌려준다(전체 paper_answers를 스캔하지 않음).
create or replace function has_cbt_answers_bulk(target_paper_ids uuid[])
returns table (paper_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select paper_answers.paper_id
  from paper_answers
  where paper_answers.paper_id = any(target_paper_ids);
$$;

grant execute on function has_cbt_answers_bulk(uuid[]) to anon, authenticated;

-- 홈 화면 검색을 서버 왕복 없이 클라이언트에서 즉시 필터링하도록 바꾸면서, 화면에
-- 보이는 문제지 id를 미리 알 수 없어졌다(필터링 자체가 클라이언트에서 일어나므로).
-- 그래서 "바로 풀기" 가능 여부를 문제지 전체에 대해 한 번에 다 받아둔다.
create or replace function has_cbt_answers_all()
returns table (paper_id uuid)
language sql
security definer
set search_path = public
stable
as $$
  select paper_answers.paper_id from paper_answers;
$$;

grant execute on function has_cbt_answers_all() to anon, authenticated;

-- 공통 지문(예: "다음 글을 읽고 5~7번에 답하시오"): 문제 여러 개가 지문 하나를 공유할 때,
-- 지문 이미지를 문제마다 중복 저장하지 않고 한 번만 저장해서 questions.passage_id로 참조한다.
create table if not exists question_passages (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table question_passages enable row level security;

drop policy if exists "public read question_passages" on question_passages;
create policy "public read question_passages" on question_passages for select using (true);

drop policy if exists "admin insert question_passages" on question_passages;
create policy "admin insert question_passages" on question_passages
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update question_passages" on question_passages;
create policy "admin update question_passages" on question_passages
  for update to authenticated using (is_admin());

drop policy if exists "admin delete question_passages" on question_passages;
create policy "admin delete question_passages" on question_passages
  for delete to authenticated using (is_admin());

-- 지문도 페이지를 넘어갈 수 있으므로 이미지 여러 장을 순서대로 저장한다.
create table if not exists question_passage_images (
  id uuid primary key default gen_random_uuid(),
  passage_id uuid not null references question_passages(id) on delete cascade,
  order_index int not null default 0,
  image_path text not null,
  unique (passage_id, order_index)
);

alter table question_passage_images enable row level security;

drop policy if exists "public read question_passage_images" on question_passage_images;
create policy "public read question_passage_images" on question_passage_images for select using (true);

drop policy if exists "admin insert question_passage_images" on question_passage_images;
create policy "admin insert question_passage_images" on question_passage_images
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update question_passage_images" on question_passage_images;
create policy "admin update question_passage_images" on question_passage_images
  for update to authenticated using (is_admin());

drop policy if exists "admin delete question_passage_images" on question_passage_images;
create policy "admin delete question_passage_images" on question_passage_images
  for delete to authenticated using (is_admin());

-- 문항 단위 데이터: 기출 섞어풀기용으로 문제 하나를 원본 페이지 맥락과 무관하게 독립적으로
-- 보여줄 수 있게 하는 최소 구조. 문제 본문/보기는 텍스트로 옮기지 않고 이미지를 그대로
-- 잘라 쓴다 (question_images). unit_tag는 오답노트 단원별 분석용이라 이미지 유무와 무관하게
-- 채워둘 수 있다. 정답은 이 테이블이 아니라 paper_answers에 그대로 둔다 (여기 두면
-- public read 정책 때문에 정답이 노출된다).
create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  choice_count smallint not null default 4,
  unit_tag text,
  passage_id uuid references question_passages(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (paper_id, question_number)
);

create index if not exists questions_paper_idx on questions(paper_id);

alter table questions enable row level security;

drop policy if exists "public read questions" on questions;
create policy "public read questions" on questions for select using (true);

drop policy if exists "admin insert questions" on questions;
create policy "admin insert questions" on questions
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update questions" on questions;
create policy "admin update questions" on questions
  for update to authenticated using (is_admin());

drop policy if exists "admin delete questions" on questions;
create policy "admin delete questions" on questions
  for delete to authenticated using (is_admin());

-- 문제 본문(지문 제외)+보기를 잘라낸 이미지. 문제가 다음 페이지로 이어지는 경우를 위해
-- 이미지 여러 장을 순서대로 저장한다 (화면에서는 순서대로 이어붙여 보여주기만 하면 됨).
create table if not exists question_images (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  order_index int not null default 0,
  image_path text not null,
  unique (question_id, order_index)
);

alter table question_images enable row level security;

drop policy if exists "public read question_images" on question_images;
create policy "public read question_images" on question_images for select using (true);

drop policy if exists "admin insert question_images" on question_images;
create policy "admin insert question_images" on question_images
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update question_images" on question_images;
create policy "admin update question_images" on question_images
  for update to authenticated using (is_admin());

drop policy if exists "admin delete question_images" on question_images;
create policy "admin delete question_images" on question_images
  for delete to authenticated using (is_admin());

-- CBT 응시 기록: 사용자가 특정 문제지(paper_id)를 몇 번째 풀었는지 1건당 1행.
create table if not exists cbt_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  score int not null default 0,
  total_questions int not null,
  duration_seconds int,
  created_at timestamptz not null default now()
);

alter table cbt_attempts add column if not exists duration_seconds int;

create index if not exists cbt_attempts_user_idx on cbt_attempts(user_id, created_at desc);
create index if not exists cbt_attempts_paper_idx on cbt_attempts(paper_id);

alter table cbt_attempts enable row level security;

drop policy if exists "select own cbt attempts" on cbt_attempts;
create policy "select own cbt attempts" on cbt_attempts
  for select to authenticated using (auth.uid() = user_id);

-- insert 정책은 의도적으로 없다: 점수·회독 수가 서버 채점 결과 그대로만 저장되도록
-- 쓰기는 서버 액션(service_role)에서만 한다. 예전에 열려 있던 "insert own cbt
-- attempts" 정책은 클라이언트가 REST 호출로 만점 응시를 위조해 공개 통계(회차별
-- 평균·전국 오답률·총 응시 수)를 오염시킬 수 있어 제거했다 (2026-07-16 보안 점검).
drop policy if exists "insert own cbt attempts" on cbt_attempts;

-- 홈 화면 "실시간 총 응시 수" 집계용: cbt_attempts는 본인 것만 select 가능한 RLS라
-- 전체 응시 건수를 세려면 security definer로 우회해야 한다.
create or replace function total_cbt_attempt_count()
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select count(*) from cbt_attempts;
$$;

grant execute on function total_cbt_attempt_count() to anon, authenticated;

-- CBT 최소 응시시간 강제용: 사용자가 채점 전 실제로 "시작"한 시각을 서버가 직접
-- 기록해둔다. 클라이언트가 보내는 durationSeconds는 조작 가능해서 신뢰할 수 없으니,
-- 채점(submitCbtAttempt) 시점에 이 시각과 현재 시각의 차이로만 최소 응시시간을
-- 검증한다. (user_id, paper_id) 1건만 유지하는 upsert 방식이라 테이블 크기가 무한정
-- 늘어나지 않고, 채점에 성공하면 즉시 삭제해 같은 시작 기록을 재사용(replay)하지
-- 못하게 막는다.
create table if not exists cbt_attempt_starts (
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  started_at timestamptz not null default now(),
  primary key (user_id, paper_id)
);

alter table cbt_attempt_starts enable row level security;

drop policy if exists "select own cbt attempt starts" on cbt_attempt_starts;
create policy "select own cbt attempt starts" on cbt_attempt_starts
  for select to authenticated using (auth.uid() = user_id);

-- 쓰기 정책은 의도적으로 없다: started_at은 서버(service_role)만 기록해야 한다.
-- 예전에 열려 있던 insert/update/delete 정책으로는 클라이언트가 REST 호출로
-- started_at을 과거로 조작해 최소 응시시간 검증을 통째로 우회할 수 있었다
-- (2026-07-16 보안 점검에서 제거).
drop policy if exists "upsert own cbt attempt starts" on cbt_attempt_starts;
drop policy if exists "update own cbt attempt starts" on cbt_attempt_starts;
drop policy if exists "delete own cbt attempt starts" on cbt_attempt_starts;

-- 문항별 응답. selected_choice가 null이면 건너뛴 문제. is_correct는 채점 시점 값을
-- 그대로 저장해서, 나중에 관리자가 정답을 고쳐도 과거 채점 결과가 뒤바뀌지 않게 한다.
-- (paper_id, question_number)가 나중에 생길 문항단위 데이터의 조인 키가 된다.
create table if not exists cbt_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references cbt_attempts(id) on delete cascade,
  question_number int not null,
  selected_choice smallint,
  is_correct boolean not null,
  unique (attempt_id, question_number)
);

create index if not exists cbt_attempt_answers_attempt_idx on cbt_attempt_answers(attempt_id);

alter table cbt_attempt_answers enable row level security;

drop policy if exists "select own cbt attempt answers" on cbt_attempt_answers;
create policy "select own cbt attempt answers" on cbt_attempt_answers
  for select to authenticated using (
    exists (
      select 1 from cbt_attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

-- insert 정책은 의도적으로 없다: 문항별 정오(is_correct)는 서버 채점 결과 그대로만
-- 저장돼야 한다. 예전에 열려 있던 insert 정책으로는 클라이언트가 가짜 정오 행을
-- 넣어 전국 오답률(paper_question_wrong_rates) 배지를 오염시킬 수 있었다
-- (2026-07-16 보안 점검에서 제거).
drop policy if exists "insert own cbt attempt answers" on cbt_attempt_answers;

-- 문항 단위 통합 상태. 오답노트 "극복" 판정과 앞으로 나올 섞어풀기(오답 재풀이)가
-- 공유하는 사용자×문항 요약이다. cbt_attempt_answers는 응시별 원본이라 "이 문항을
-- 지금까지 몇 번 틀렸나 / 가장 최근엔 맞혔나"를 매번 응시 전체에서 재계산해야 하는데,
-- 섞어풀기는 문제지 단위 응시가 아니라 그 파생 계산으로는 표현이 안 된다. 그래서
-- CBT 채점과 섞어풀기 채점 양쪽이 이 테이블을 갱신하고, 극복 판정은 여기를 본다.
--
-- 키를 questions.id가 아니라 (paper_id, question_number)로 잡는다: 채점 원본
-- (cbt_attempt_answers)이 이 쌍으로 기록되고, 크롭 전(questions 행이 아직 없는)
-- 문제지도 CBT를 지원하므로 questions.id 의존을 피한다. 중복 시험지(직류만 다른
-- 같은 시험지)는 읽는 쪽(dedup-papers 대표)에서 합친다.
--
-- wrong_count: 틀린 채로 제출된 횟수(제출 1회당 최대 +1). last_is_correct/
-- last_answered_at: 가장 최근 제출 기준. source: 'cbt' | 'review'(섞어풀기).
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

-- 쓰기 정책은 의도적으로 없다: 극복 여부(last_is_correct)·오답 횟수(wrong_count)는
-- 서버 채점 결과로만 갱신돼야 한다. 예전에 열려 있던 insert/update 정책으로는
-- 클라이언트가 REST 호출로 오답 기록을 임의 조작할 수 있었다(2026-07-16 보안
-- 점검에서 제거 — 쓰기는 recordQuestionResults가 service_role로 수행).
drop policy if exists "insert own question status" on user_question_status;
drop policy if exists "update own question status" on user_question_status;

-- 섞어풀기(오답 재풀이) 세션과 그 문항. 오답노트에서 고른 틀린 문항들을 무작위로
-- 섞어 다시 CBT처럼 풀고, 결과를 user_question_status(극복 판정)에 반영한다.
-- 정답(is_correct/채점 결과)이 담기므로, paper_answers·question_explanations와 같이
-- 클라이언트 직접 접근을 전부 막고(정책 0개 = RLS가 모든 접근 차단) 서버 액션에서
-- service_role로만 읽고 쓴다. 채점 전까지 score/is_correct는 null.
create table if not exists review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- null이면 전체 과목 범위. 과목이 지워져도 세션 기록은 남기려 set null.
  subject_id uuid references subjects(id) on delete set null,
  scope text not null default 'subject',      -- 'subject' | 'all'
  only_unresolved boolean not null default true,
  total_questions int not null default 0,
  score int,                                   -- 채점 후 채워짐
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index if not exists review_sessions_user_idx
  on review_sessions(user_id, created_at desc);

alter table review_sessions enable row level security;
-- 클라이언트 직접 접근 없음: 서버 액션에서 service_role로만.

create table if not exists review_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references review_sessions(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  position int not null,                       -- 섞인 출제 순서(0부터)
  selected_choice smallint,                    -- 채점 전 사용자가 고른 답
  is_correct boolean,                          -- 채점 후 채워짐
  unique (session_id, position)
);

create index if not exists review_session_items_session_idx
  on review_session_items(session_id, position);

alter table review_session_items enable row level security;
-- 클라이언트 직접 접근 없음: 서버 액션에서 service_role로만.

-- AI 약점 진단(일 1회). 사용자의 오답·응시 통계를 바탕으로 취약 개념·과목별 흐름을
-- 정리한 리포트를 하루 한 번 제공한다. report가 null이면 "요청됨, 아직 생성 안 됨"
-- 상태 — 생성기(Claude Code 배치/스크립트 또는 온디맨드 API)가 나중에 채운다.
-- 사용자는 자기 요청 행만 만들 수 있고(report null), report 본문은 service_role만
-- 쓴다(가짜 리포트 주입 방지).
create table if not exists ai_diagnoses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- "일 1회"를 DB 제약으로 강제(KST 기준 날짜 문자열을 서버가 넣는다).
  diagnosis_date date not null,
  report jsonb,                      -- null = 요청됨/생성 대기
  model text,                        -- 생성에 쓴 모델(기록용)
  requested_at timestamptz not null default now(),
  generated_at timestamptz,
  unique (user_id, diagnosis_date)
);

create index if not exists ai_diagnoses_user_idx
  on ai_diagnoses(user_id, diagnosis_date desc);

alter table ai_diagnoses enable row level security;

drop policy if exists "select own diagnoses" on ai_diagnoses;
create policy "select own diagnoses" on ai_diagnoses
  for select to authenticated using (auth.uid() = user_id);

-- 사용자는 "오늘 진단 요청"만 만들 수 있다(report는 반드시 null). report 본문 작성은
-- service_role(생성기) 몫이라 update 정책을 주지 않는다.
drop policy if exists "insert own diagnosis request" on ai_diagnoses;
create policy "insert own diagnosis request" on ai_diagnoses
  for insert to authenticated with check (auth.uid() = user_id and report is null);

-- 문항 메모: 오답노트 문항별로 사용자가 남기는 개인 메모("내 노트"). 본인만 읽고 쓴다.
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

-- 전국 오답률: 문항별 "전체 응시자 중 몇 %가 틀렸나"를 집계해 돌려준다. cbt_attempt_answers는
-- 본인 것만 select 가능한 RLS라, 전체 집계는 security definer로 우회한다. 반환값은 정답이
-- 아니라 오답 "비율"뿐이라 정답 유출이 아니다(공개 정답지 PDF와 무관). 표본이 적은 문항은
-- 호출부에서 배지를 숨긴다(작은 표본은 오해를 준다).
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

-- 회원가입 IP 레이트리밋: 캡차(Turnstile)와 별개로 짧은 시간 동안의 대량 가입 시도를
-- 막는 2차 방어선. 성공/실패 관계없이 시도할 때마다 한 행씩 기록한다.
create table if not exists signup_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  created_at timestamptz not null default now()
);

create index if not exists signup_attempts_ip_idx on signup_attempts(ip_address, created_at desc);

alter table signup_attempts enable row level security;
-- 클라이언트에서는 직접 못 건드리고, 서버 액션에서 service_role로만 기록/조회한다.
-- (anon/authenticated에 아무 정책도 주지 않으므로 RLS가 모든 접근을 막는다.)

-- 아이디(이메일) 찾기 / 비밀번호 재설정 요청의 IP 레이트리밋. signup_attempts와 같은
-- 패턴이지만 액션별로 한도를 다르게 두기 위해 action 컬럼으로 구분한다.
create table if not exists auth_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_address text not null,
  action text not null check (action in ('find_id', 'reset_password')),
  created_at timestamptz not null default now()
);

create index if not exists auth_attempts_ip_action_idx on auth_attempts(ip_address, action, created_at desc);

alter table auth_attempts enable row level security;
-- signup_attempts와 동일하게 anon/authenticated 정책 없이 서버 액션의 service_role만 접근.

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

-- 닉네임 중복확인/유일성 보장용 그림자 원장. auth.users.raw_user_meta_data.nickname을
-- 화면에 보여주는 값의 원본으로 그대로 쓰고, 이 테이블은 "이 닉네임을 이미 누가 쓰고
-- 있는지"만 판별하는 용도다 (auth.users는 공개 API로 직접 조회가 안 되기 때문).
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nickname text not null,
  created_at timestamptz not null default now()
);

do $$ begin
  alter table profiles add constraint profiles_nickname_len
    check (char_length(nickname) between 2 and 10);
exception when duplicate_object then null; end $$;

-- 대소문자 구분 없이 유일해야 하므로 lower(nickname)에 유니크 인덱스를 건다.
create unique index if not exists profiles_nickname_unique_idx on profiles (lower(nickname));

alter table profiles enable row level security;

drop policy if exists "select own profile" on profiles;
create policy "select own profile" on profiles
  for select to authenticated using (auth.uid() = user_id);

-- insert/update는 서버 액션에서 service role로만 수행한다 (유니크 위반을 애플리케이션이
-- 깔끔한 에러 메시지로 바꿔줄 수 있게 anon/authenticated에는 쓰기 정책을 열지 않음).

-- 닉네임 중복확인: 정답지/CBT 지원 여부 확인용 함수들과 같은 패턴으로, 존재 여부만
-- security definer로 안전하게 알려준다. exclude_user_id는 "내 현재 닉네임"을 중복으로
-- 오판하지 않게 본인 계정은 검사 대상에서 빼기 위한 값이다.
create or replace function is_nickname_taken(check_nickname text, exclude_user_id uuid default null)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from profiles
    where lower(nickname) = lower(check_nickname)
      and (exclude_user_id is null or user_id <> exclude_user_id)
  );
$$;

grant execute on function is_nickname_taken(text, uuid) to anon, authenticated;

-- 로그인 아이디가 이메일 자체로 바뀌면서(가짜 도메인 트릭 폐기) 더 이상 쓰지 않는다.
drop function if exists is_username_taken(text);

-- 문제지 상세페이지 "내 기록보기"에서, 내 점수와 함께 "다른 사람들은 몇 회독에 평균
-- 몇 점이었는지" 보여주기 위한 집계. cbt_attempts는 본인 것만 select 가능한 RLS라
-- (다른 사용자 응시 기록은 직접 조회 불가) security definer로 전체를 집계해서
-- 회차(round)별 평균만 반환한다. 응시자가 3명 미만인 회차는 여기서 아예 제외한다:
-- 표본이 너무 작으면 평균 자체가 왜곡되기도 하고, 1~2명뿐이면 "평균"이 사실상 그
-- 사람의 점수 그대로라 익명성이 깨진다. 이 함수는 anon/authenticated가 직접 호출할
-- 수 있으므로, 이 최소 인원 기준은 클라이언트가 아니라 여기 SQL에서 강제해야 의미가 있다.
create or replace function avg_score_by_round(target_paper_id uuid)
returns table (round int, avg_pct numeric, attempt_count bigint)
language sql
security definer
set search_path = public
stable
as $$
  with ranked as (
    select
      row_number() over (partition by user_id order by created_at) as round,
      case when total_questions > 0 then (score::numeric / total_questions) * 100 else 0 end as pct
    from cbt_attempts
    where paper_id = target_paper_id
  )
  select
    round,
    round(avg(pct), 1) as avg_pct,
    count(*) as attempt_count
  from ranked
  group by round
  having count(*) >= 3
  order by round;
$$;

grant execute on function avg_score_by_round(uuid) to anon, authenticated;

-- 문항 해설. 해설 제작 루틴(별도 세션)이 만들고 채우는 테이블이라 이 스키마 파일이
-- 아니라 그 루틴이 원본 소유자다 — 여기 정의는 새 환경 재현용이며, 컬럼 구조는
-- 루틴 쪽과 맞춰서만 바꿀 것. questions.id를 키로 쓰므로 화면(오답노트/전체 해설)은
-- questions를 거쳐 (paper_id, question_number)로 환원해 읽는다.
-- 해설 본문에는 사실상 정답이 담기므로(correct_choice_number, 선지별 해설 등)
-- paper_answers처럼 일반 select를 열지 않고 관리자/서버(service role) 전용으로
-- 격리한다.
create table if not exists question_explanations (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  question_text text,
  keyword_title text,
  keyword_explanation text,
  choice_explanations jsonb,
  correct_choice_number smallint,
  correct_choice_summary text,
  law_amendment_note text,
  verified boolean not null default false,
  model_version text,
  created_at timestamptz not null default now()
);

-- 법령 문항 해설의 "현행법 기준" 확장 컬럼 (전부 nullable — 기존 행/기존 렌더링과 호환).
-- 원칙: 해설 본문(선지 판정 포함)은 현행법 기준으로 생성하고, correct_choice_number는
-- 언제나 출제 당시 공식 정답 그대로 둔다(채점·verify와 정합 — 정답 검증 파이프라인은
-- 손대지 않는다). "출제 당시에는 어땠나"는 선지별 original_note로, 개정이 정답 자체를
-- 흔드는지는 아래 컬럼으로 담는다.
--   current_answer_status: 개정이 이 문항 정답에 미치는 영향
--     '동일'     = 현행법으로도 정답 번호가 그대로
--     '정답변경' = 현행법 기준으로는 다른 선지가 정답이 됨 (화면 상단 경고 배지 대상)
--     '성립불가' = 근거 조문 폐지/전면개정으로 현행 기준 문제가 성립하지 않음
--     null       = 법령 문항이 아니거나 판단 보류 (비법령 문항은 항상 null)
--   current_answer_note: 정답변경/성립불가일 때 그 이유 한두 줄 (동일이면 보통 null)
--   law_basis_date: 이 해설이 참조한 "현행"의 기준 시점(예: "2026-07"). "현행법"은
--     시간이 지나면 낡으므로, 나중에 개정 발생 시 이 값으로 재생성 대상을 골라낸다.
-- 선지별 개정 정보(current_status/original_note)는 choice_explanations jsonb 안에
-- 항목별로 함께 담기므로 별도 컬럼이 없다(스키마 변경 불필요).
alter table question_explanations add column if not exists current_answer_status text;
alter table question_explanations add column if not exists current_answer_note text;
alter table question_explanations add column if not exists law_basis_date text;

create index if not exists question_explanations_question_idx on question_explanations(question_id);

alter table question_explanations enable row level security;

drop policy if exists "admin read question_explanations" on question_explanations;
create policy "admin read question_explanations" on question_explanations
  for select to authenticated using (is_admin());

drop policy if exists "admin insert question_explanations" on question_explanations;
create policy "admin insert question_explanations" on question_explanations
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update question_explanations" on question_explanations;
create policy "admin update question_explanations" on question_explanations
  for update to authenticated using (is_admin());

drop policy if exists "admin delete question_explanations" on question_explanations;
create policy "admin delete question_explanations" on question_explanations
  for delete to authenticated using (is_admin());

-- 법령 다이제스트(선택적 근거 캐시). 법령·조문 단위로 "현행 규정 요약 + 주요 개정
-- 연혁"을 실제 확인된 것만 쌓아두는 테이블. 해설 생성 시 이 요약을 프롬프트에
-- 주입하면 (1) 같은 법을 문항마다 다르게 말하는 비일관성이 사라지고 (2) 다이제스트
-- 한 건만 사람이 검수하면 그 법의 모든 해설이 검증되며 (3) 재개정 시 다이제스트만
-- 갱신하면 참조 문항을 일괄 재생성할 수 있다. 비어 있어도 무방하다 — 그 경우
-- 해설 생성기는 확실한 것만 쓰고 불확실하면 '확인불가'로 남긴다(지어내지 않는다).
-- 지금 당장 채우지 않아도 되며, 파일럿 과목부터 점진적으로 채우는 것을 전제로 둔다.
create table if not exists law_digests (
  id uuid primary key default gen_random_uuid(),
  law_name text not null,             -- 예: "지방세법"
  article text,                       -- 예: "제71조" (법 전체 요약이면 null)
  current_summary text not null,      -- 현행 규정 요약 (사람이 검수한 사실만)
  amendment_history text,             -- 주요 개정 연혁 (연도·내용)
  source_url text,                    -- 근거 출처(국가법령정보센터 등)
  basis_date text,                    -- 이 요약이 확인된 기준 시점(예: "2026-07")
  verified_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists law_digests_law_name_idx on law_digests(law_name);

alter table law_digests enable row level security;

drop policy if exists "admin read law_digests" on law_digests;
create policy "admin read law_digests" on law_digests
  for select to authenticated using (is_admin());

drop policy if exists "admin write law_digests" on law_digests;
create policy "admin write law_digests" on law_digests
  for all to authenticated using (is_admin()) with check (is_admin());

-- 해설 열람/다운로드 대량 수집 방지용 요청 로그. 로그인 사용자별로 최근 1시간
-- 이내 행 수를 세어 시간당 한도(explanation-rate-limit.ts)를 넘으면 그 요청은
-- 전체 해설 대신 미리보기로 되돌아간다. 클라이언트가 직접 읽거나 쓸 일이 없는
-- 내부 집계 전용 테이블이라 RLS만 켜두고 정책은 두지 않는다 — signup_attempts와
-- 같은 방식으로, anon/authenticated는 전부 차단되고 서버 액션에서 service_role로만
-- 기록/조회한다.
create table if not exists explanation_access_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  action text not null check (action in ('view', 'download')),
  created_at timestamptz not null default now()
);

create index if not exists explanation_access_log_user_idx
  on explanation_access_log(user_id, action, created_at desc);

alter table explanation_access_log enable row level security;
