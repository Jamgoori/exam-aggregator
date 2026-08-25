-- 해설 배치 "다음 청크 찾기" RPC (2026-08-25)
--
-- 왜: scripts/next-explanation-chunk.mjs 가 우선순위 그룹의 문제지를 하나씩 돌며
-- 문제지마다 (questions, question_explanations) 2왕복을 치르는 구조라, 완료 문제지가
-- 쌓일수록 스캔이 느려졌다(최우선 그룹 문제지 491개 기준 청크 하나에 실측 20~35분
-- = REST 왕복 약 1,000번). 이 함수는 그 순회 전체 — 우선순위 정렬, 제외 과목,
-- 문제지 정렬, 미해설 문항(NOT EXISTS anti-join), 이미지 목록 — 를 DB 안에서 한
-- 번에 계산해 왕복 1번으로 줄인다.
--
-- 스크립트는 이 함수가 없으면(PGRST202) 자동으로 클라이언트 벌크 조회로 폴백하므로,
-- 마이그레이션 적용 전에도 배치는 깨지지 않는다. 적용 순서는 자유다.
--
-- 실행: supabase db query --linked < 이 파일   (또는 SQL Editor, service role)
--       create or replace 라 여러 번 돌려도 안전(additive, 데이터 변경 없음).
--       참고: 운영 DB 적용용 SQL 모음은 apps/web/scripts/sql/ 에 있고, 이 파일은
--       소유자 요청에 따라 supabase/migrations/ 에 둔다 (supabase CLI 마이그레이션
--       경로). schema.sql 에는 넣지 않는다 — 이 함수가 참조하는
--       explanation_batch_priority / explanation_excluded_subjects 는 운영 DB에만
--       있는 테이블이라(schema.sql 미수록), 넣으면 새 환경 재현이 깨진다.
--
-- 정렬 계약 (스크립트의 종전 PostgREST 쿼리와 바이트 단위로 같은 순서여야 한다):
--   그룹:   priority asc, exam_type_id asc, level asc   — PostgREST asc 기본이
--           nulls last 이고 PostgreSQL asc 기본도 nulls last 라 그대로 일치한다.
--   문제지: year asc, id asc (그룹 안에서).
--   역방향: 위 전순서(全順序)의 정확한 거울이어야 한다. 키마다 desc 를 다시 쓰는
--           대신 순방향 순번(gord)을 매겨 -gord 로 뒤집는다 — asc nulls last 의
--           반전은 desc nulls first 이고 그게 PostgREST desc 기본과 같다.
--   문항:   question_number asc (방향 무관 — 청크 경계는 항상 순방향 기준).
--   이미지: order_index asc.
--
-- 반환 jsonb:
--   {
--     "priorities_empty": bool,   -- explanation_batch_priority 가 비어 있는지
--                                 -- (스크립트의 done reason 구분에 필요)
--     "papers": [                 -- 미해설 문항이 남은 앞쪽 문제지 p_max_papers개
--       { "paper": { "id","title","year","level" },
--         "subject_id": "...",
--         "questions": [ { "question_id","question_number","image_paths":[...] } ] }
--     ]
--   }
--   세트 판정(set_key = 첫 image_path)과 청크 분할은 스크립트가 한다 — 분할 규칙이
--   두 군데 살면 순/역방향 수렴 경계가 어긋날 수 있어서 DB에는 두지 않는다.
--
-- 권한: verify_question_answer() 와 같은 패턴 — security definer 로 RLS 를 우회하고
-- (question_explanations 존재 여부와 explanation_batch_priority 를 읽어야 하는데,
-- 둘 다 admin/봇 전용 테이블이다), authenticated 에만 execute 를 준다. 노출되는
-- 정보는 "어떤 공개 문항에 아직 해설이 없는가"와 우선순위 설정뿐 — 정답·해설 본문은
-- 다루지 않는다.
--
-- 필요한 인덱스는 전부 기존 것으로 충분하다: questions_paper_idx(paper_id),
-- question_explanations_question_idx(question_id), exam_papers_exam_type_idx.

create or replace function next_explanation_pending_papers(
  p_reverse boolean default false,
  p_max_papers int default 3
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
with groups as (
  -- 우선순위 그룹의 순방향 순번. tiebreaker 까지 명시해 두 방향이 어긋나지 않게 한다.
  select exam_type_id, level,
         row_number() over (order by priority asc, exam_type_id asc, level asc) as grank
  from explanation_batch_priority
),
candidate_papers as (
  -- 그룹 순번 → 그룹 안 (year, id) 로 전체 순회 순번(gord)을 매긴다.
  -- level 은 null 그룹(경찰·계리직)이 있어 is not distinct from 으로 맞춘다.
  select p.id, p.title, p.year, p.level, p.subject_id,
         row_number() over (order by g.grank asc, p.year asc, p.id asc) as gord
  from groups g
  join exam_papers p
    on p.exam_type_id = g.exam_type_id
   and p.level is not distinct from g.level
  where not exists (
    select 1 from explanation_excluded_subjects x where x.subject_id = p.subject_id
  )
),
pending_counts as (
  -- 미해설 문항 수. NOT EXISTS anti-join 하나로 "이 문제지는 이미 끝났는가"를
  -- 문제지별 왕복 없이 한 번에 계산한다.
  select q.paper_id, count(*) as pending_count
  from questions q
  where q.paper_id in (select id from candidate_papers)
    and not exists (select 1 from question_explanations e where e.question_id = q.id)
  group by q.paper_id
),
target_papers as (
  -- 진행 방향 기준 "맨 앞" 문제지 p_max_papers개. 청크는 문제지당 최소 1개
  -- 나오므로, 호출부(maxChunks)가 요구하는 청크 수만큼의 문제지면 항상 충분하다.
  select cp.*
  from candidate_papers cp
  join pending_counts pc on pc.paper_id = cp.id
  where pc.pending_count > 0
  order by case when p_reverse then -cp.gord else cp.gord end
  limit least(greatest(coalesce(p_max_papers, 1), 1), 50)
),
paper_payloads as (
  select t.gord,
         jsonb_build_object(
           'paper', jsonb_build_object(
             'id', t.id, 'title', t.title, 'year', t.year, 'level', t.level
           ),
           'subject_id', t.subject_id,
           'questions', coalesce(
             (
               select jsonb_agg(
                 jsonb_build_object(
                   'question_id', q.id,
                   'question_number', q.question_number,
                   'image_paths', coalesce(img.paths, '[]'::jsonb)
                 )
                 order by q.question_number asc
               )
               from questions q
               left join lateral (
                 select jsonb_agg(qi.image_path order by qi.order_index asc) as paths
                 from question_images qi
                 where qi.question_id = q.id
               ) img on true
               where q.paper_id = t.id
                 and not exists (
                   select 1 from question_explanations e where e.question_id = q.id
                 )
             ),
             '[]'::jsonb
           )
         ) as payload
  from target_papers t
)
select jsonb_build_object(
  'priorities_empty', not exists (select 1 from explanation_batch_priority),
  'papers', coalesce(
    (
      select jsonb_agg(pp.payload order by case when p_reverse then -pp.gord else pp.gord end)
      from paper_payloads pp
    ),
    '[]'::jsonb
  )
)
$$;

comment on function next_explanation_pending_papers(boolean, int) is
  '해설 배치용: 미해설 문항이 남은 앞쪽 문제지 p_max_papers개의 pending 목록을 우선순위 순서로 반환 (next-explanation-chunk.mjs 전용)';

-- security definer 함수는 기본 execute(public) 를 걷어내고 필요한 롤에만 준다.
-- 봇 계정은 authenticated 로 로그인해 호출한다 (verify_question_answer 와 동일).
revoke all on function next_explanation_pending_papers(boolean, int) from public;
revoke all on function next_explanation_pending_papers(boolean, int) from anon;
grant execute on function next_explanation_pending_papers(boolean, int) to authenticated, service_role;
