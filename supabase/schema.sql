-- Run this in the Supabase SQL editor (Project > SQL Editor > New query) once.

create extension if not exists "pgcrypto";

-- 과목 (국어, 영어, 한국사, 행정법 ...)
create table if not exists subjects (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,          -- e.g. "korean", "english", "korean-history"
  name text not null,                 -- e.g. "국어"
  display_order int not null default 0
);

-- 시험 종류 (국가직 9급, 지방직 9급, 서울시 9급 ...)
create table if not exists exam_types (
  id uuid primary key default gen_random_uuid(),
  name text unique not null
);

-- 실제 업로드되는 기출문제 PDF 한 건 = 특정 연도/시험/과목의 문제지
create table if not exists exam_papers (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete restrict,
  exam_type_id uuid not null references exam_types(id) on delete restrict,
  year int not null,
  round int not null default 1,       -- 같은 해 여러 회차가 있는 경우 대비
  title text not null,                -- e.g. "2024 국가직 9급 국어"
  file_path text not null,            -- Supabase Storage 내 경로
  file_name text not null,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists exam_papers_subject_idx on exam_papers(subject_id);
create index if not exists exam_papers_year_idx on exam_papers(year desc);

-- RLS
alter table subjects enable row level security;
alter table exam_types enable row level security;
alter table exam_papers enable row level security;

-- 누구나 읽기 가능 (공개 사이트)
create policy "public read subjects" on subjects for select using (true);
create policy "public read exam_types" on exam_types for select using (true);
create policy "public read exam_papers" on exam_papers for select using (true);

-- 로그인한 사용자만 쓰기 가능 (1인 관리자 운영 기준. 관리자를 여러 명 두려면
-- auth.jwt()->>'email' 을 화이트리스트와 비교하는 조건을 추가하세요)
create policy "authenticated insert exam_papers" on exam_papers
  for insert to authenticated with check (true);
create policy "authenticated update exam_papers" on exam_papers
  for update to authenticated using (true);
create policy "authenticated delete exam_papers" on exam_papers
  for delete to authenticated using (true);

-- 초기 과목 데이터 (9급 공무원 시험 기준 예시, 필요에 맞게 수정하세요)
insert into subjects (slug, name, display_order) values
  ('korean', '국어', 1),
  ('english', '영어', 2),
  ('korean-history', '한국사', 3),
  ('administrative-law', '행정법총론', 4),
  ('administration', '행정학개론', 5)
on conflict (slug) do nothing;

insert into exam_types (name) values
  ('국가직 9급'),
  ('지방직 9급'),
  ('서울시 9급')
on conflict (name) do nothing;
