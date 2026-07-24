-- AI 약점 진단(일 1회) 테이블 신설
-- 실행: Supabase SQL Editor (service role). additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용). 백필 없음(신규 기능).
--
-- report가 null이면 "요청됨, 아직 생성 안 됨". 사용자는 자기 요청 행만 만들 수 있고
-- (report null), report 본문 작성은 service_role(생성기)만 한다.

begin;

create table if not exists ai_diagnoses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  diagnosis_date date not null,
  report jsonb,
  model text,
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

drop policy if exists "insert own diagnosis request" on ai_diagnoses;
create policy "insert own diagnosis request" on ai_diagnoses
  for insert to authenticated with check (auth.uid() = user_id and report is null);

commit;
