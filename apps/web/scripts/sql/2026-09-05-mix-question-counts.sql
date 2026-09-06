-- 기출 섞어풀기 허브(/mix)의 "풀 수 있는 문항 수" 집계 함수.
--
-- 허브는 과목 수십 개를 한 화면에 늘어놓는데, 과목마다 출제 풀(getMixPool)을 돌리면
-- 문항 단위 조회가 과목 수만큼 붙는다(과목 하나에 수십 회 왕복). 그렇다고 문제지 수를
-- 보여주면 "20문항 풀기"를 고르는 화면에서 단위가 어긋난다. 그래서 문제지별 출제 가능
-- 문항 수만 DB 에서 한 번에 집계해 받는다.
--
-- "출제 가능"의 뜻은 앱 코드(mix-practice.ts)와 같다:
--   · 정답이 등록된 문제지만(paper_answers 조인) — 채점할 수 없으면 낼 수 없다
--   · 크롭 이미지가 있는 문항만 — 문제를 보여줄 수 없으면 못 푼다
--   · voided(전항정답·복수정답) 문항 제외 — 맞다/틀리다를 말할 수 없다
-- 정답 "내용"은 돌려주지 않는다(개수만) — paper_answers 는 RLS 로 잠겨 있으므로
-- security definer 로 두되, 노출되는 값은 집계 수치뿐이다.
--
-- 중복 시험지(직류만 다른 같은 시험지) 합치기는 여기서 하지 않는다. 대표 선정 규칙이
-- 앱(@gongmoa/core 의 representativePaperIds)에 있고, 정답 대조까지 보기 때문이다 —
-- 호출부가 대표 문제지의 값만 골라 쓴다.
create or replace function mix_playable_question_counts()
returns table(paper_id uuid, question_count int)
language sql
stable
security definer
set search_path = public
as $$
  select q.paper_id, count(*)::int as question_count
  from questions q
  join paper_answers pa on pa.paper_id = q.paper_id
  where exists (select 1 from question_images qi where qi.question_id = q.id)
    and not (q.question_number = any(pa.voided_questions))
  group by q.paper_id;
$$;

grant execute on function mix_playable_question_counts() to anon, authenticated;
