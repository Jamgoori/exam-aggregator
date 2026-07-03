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
grant select (id, paper_id, user_id, nickname, content, created_at, updated_at)
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

drop policy if exists "insert own cbt attempts" on cbt_attempts;
create policy "insert own cbt attempts" on cbt_attempts
  for insert to authenticated with check (auth.uid() = user_id);

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

drop policy if exists "insert own cbt attempt answers" on cbt_attempt_answers;
create policy "insert own cbt attempt answers" on cbt_attempt_answers
  for insert to authenticated with check (
    exists (
      select 1 from cbt_attempts a
      where a.id = attempt_id and a.user_id = auth.uid()
    )
  );

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
