-- 법령 문항 해설 "현행법 기준" 전략 마이그레이션
-- 실행: Supabase SQL Editor (service role). 전부 additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용). 여기 파일은 운영 DB에 바로
-- 적용하기 위한 실행본이다.
--
-- 무엇을 바꾸나:
--  1) question_explanations에 문항 레벨 "현행법 영향" 컬럼 3개 추가 (전부 nullable).
--  2) 선택적 근거 캐시 테이블 law_digests 신설.
-- 정답 검증 파이프라인(verify_question_answer, paper_answers)은 건드리지 않는다.

begin;

-- 1) 문항 레벨 현행법 컬럼 -------------------------------------------------------
--   current_answer_status: '동일' | '정답변경' | '성립불가' | null(비법령/보류)
--   current_answer_note   : 정답변경/성립불가 사유 한두 줄
--   law_basis_date        : 참조한 "현행"의 기준 시점(예: "2026-07")
alter table question_explanations add column if not exists current_answer_status text;
alter table question_explanations add column if not exists current_answer_note text;
alter table question_explanations add column if not exists law_basis_date text;

-- 선지별 개정 정보(current_status/original_note)는 choice_explanations jsonb 안에
-- 항목별로 담기므로 컬럼 추가가 필요 없다.

-- 2) 법령 다이제스트(선택적 근거 캐시) ------------------------------------------
create table if not exists law_digests (
  id uuid primary key default gen_random_uuid(),
  law_name text not null,
  article text,
  current_summary text not null,
  amendment_history text,
  source_url text,
  basis_date text,
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

commit;
