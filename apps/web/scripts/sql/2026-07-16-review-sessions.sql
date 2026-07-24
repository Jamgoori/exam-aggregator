-- 섞어풀기(오답 재풀이) 세션 테이블 신설
-- 실행: Supabase SQL Editor (service role). additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용).
--
-- 정답/채점 결과가 담기므로 paper_answers처럼 클라이언트 직접 접근을 전부 막는다
-- (RLS enable + 정책 0개). 모든 읽기·쓰기는 서버 액션에서 service_role로만.
-- 백필 없음(신규 기능이라 기존 데이터 없음).

begin;

create table if not exists review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_id uuid references subjects(id) on delete set null,
  scope text not null default 'subject',
  only_unresolved boolean not null default true,
  total_questions int not null default 0,
  score int,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create index if not exists review_sessions_user_idx
  on review_sessions(user_id, created_at desc);

alter table review_sessions enable row level security;

create table if not exists review_session_items (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references review_sessions(id) on delete cascade,
  paper_id uuid not null references exam_papers(id) on delete cascade,
  question_number int not null,
  position int not null,
  selected_choice smallint,
  is_correct boolean,
  unique (session_id, position)
);

create index if not exists review_session_items_session_idx
  on review_session_items(session_id, position);

alter table review_session_items enable row level security;

commit;
