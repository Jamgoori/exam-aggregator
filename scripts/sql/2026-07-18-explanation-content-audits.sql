-- 해설 "내용" 표본감사 테이블 + 무작위 표본 함수 신설
-- 실행: Supabase SQL Editor (service role). additive/idempotent라 여러 번 돌려도 안전.
-- schema.sql에도 같은 정의가 반영돼 있다(새 환경 재현용).
--
-- 배경: 기존 자동 검증은 save-explanations.mjs의 verify_question_answer() 하나뿐이고,
-- 이는 "정답 번호가 정답표와 맞는가"만 본다. 정답 번호는 맞지만 해설 내용이 틀린 경우
-- (법령 조문 오인용, 날짜·수치 환각, 현행법 판단 오류 등)는 못 잡는다. 이 사각지대를
-- 메우기 위해, 별도 표본감사 루틴이 무작위 표본을 Opus로 채점해 그 결과를 여기 쌓는다.
--   - status='passed' : 내용 사실오류 없음으로 통과 분류된 해설
--   - status='failed' : 명백한 사실오류가 발견된 해설 (issues에 구체 내용).
--     이 경우 감사 루틴이 question_explanations.verified=false로 내려 사용자에게
--     숨기고, 관리자 미검증 검수화면에 노출한다(기존 숨김 메커니즘 재사용).
-- question_id에 unique를 걸어 재감사 시 upsert로 갱신한다. question_explanations의
-- unique 인덱스/upsert 경로는 전혀 건드리지 않는다(완전 분리된 테이블).

begin;

create table if not exists explanation_content_audits (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  status text not null check (status in ('passed', 'failed')),
  issues text,               -- failed일 때 발견한 구체 오류. passed면 null.
  model_version text,
  audited_at timestamptz not null default now()
);

-- upsert(onConflict question_id) 전제조건: 문항당 현재 감사 결과 1건만 유지
create unique index if not exists explanation_content_audits_question_uidx
  on explanation_content_audits(question_id);

alter table explanation_content_audits enable row level security;

-- question_explanations와 동일하게 admin(해설봇 포함)만 읽고 쓴다.
drop policy if exists "admin read explanation_content_audits" on explanation_content_audits;
create policy "admin read explanation_content_audits" on explanation_content_audits
  for select to authenticated using (is_admin());

drop policy if exists "admin insert explanation_content_audits" on explanation_content_audits;
create policy "admin insert explanation_content_audits" on explanation_content_audits
  for insert to authenticated with check (is_admin());

drop policy if exists "admin update explanation_content_audits" on explanation_content_audits;
create policy "admin update explanation_content_audits" on explanation_content_audits
  for update to authenticated using (is_admin());

drop policy if exists "admin delete explanation_content_audits" on explanation_content_audits;
create policy "admin delete explanation_content_audits" on explanation_content_audits
  for delete to authenticated using (is_admin());

-- 아직 감사되지 않은(=explanation_content_audits에 행이 없는) 해설 중에서 무작위로
-- sample_size개를 뽑아 감사에 필요한 필드 일체를 반환한다. PostgREST로는 LEFT JOIN +
-- IS NULL + ORDER BY random()을 못 하므로 함수로 감싼다.
--   - SECURITY INVOKER(기본): 호출자 권한 + RLS로 실행 → admin(봇)만 데이터를 받고,
--     일반 사용자가 호출하면 RLS에 막혀 0행이 나온다(내용 유출 없음).
--   - verified=false(이미 숨겨진/미검증) 해설은 감사 대상에서 제외한다.
--   - sample_size는 1~50으로 클램프.
create or replace function sample_unaudited_explanations(sample_size int)
returns table (
  question_id uuid,
  paper_id uuid,
  question_number int,
  keyword_title text,
  keyword_explanation text,
  question_text text,
  correct_choice_number smallint,
  correct_choice_summary text,
  choice_explanations jsonb,
  current_answer_status text,
  current_answer_note text,
  law_basis_date text,
  image_paths text[]
)
language sql
stable
as $$
  select
    qe.question_id,
    q.paper_id,
    q.question_number,
    qe.keyword_title,
    qe.keyword_explanation,
    qe.question_text,
    qe.correct_choice_number,
    qe.correct_choice_summary,
    qe.choice_explanations,
    qe.current_answer_status,
    qe.current_answer_note,
    qe.law_basis_date,
    (
      select array_agg(img.image_path order by img.order_index)
      from question_images img
      where img.question_id = qe.question_id
    ) as image_paths
  from question_explanations qe
  join questions q on q.id = qe.question_id
  left join explanation_content_audits a on a.question_id = qe.question_id
  where a.id is null
    and qe.verified = true
  order by random()
  limit greatest(1, least(coalesce(sample_size, 10), 50));
$$;

grant execute on function sample_unaudited_explanations(int) to authenticated;

commit;
