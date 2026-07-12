-- 기존 법령 문항 해설 삭제 스크립트
-- 실행: Supabase SQL Editor (service role). 아래 STEP을 순서대로, 하나씩 확인하며 실행.
--
-- 왜 과목이 아니라 정규식인가:
--   과목명에 "법" 유무가 법 문항 여부를 결정하지 못한다(정보보호론에도 법 문항 2~3개).
--   대상은 원본 문제가 아니라 "이미 생성된 해설 텍스트"라, 법 해설이 법령명·조문 인용
--   없이 쓰였을 확률이 매우 낮다 → recall 편향 정규식이 실무적으로 잘 통한다.
--   과잉 삭제 비용은 "같은 형식으로 재생성되는 토큰"뿐이라 정밀도보다 재현율이 중요하다.
--
-- 중요 — 실행 순서:
--   이 삭제는 반드시 "새 프롬프트가 Storage에 배포된 뒤"에 한다. 그래야 배치 크론이
--   빈자리를 도로 채워도 새 프롬프트로 채우고, 삭제 누락이 나중에 발견돼도 치명적이지
--   않다(새 프롬프트가 다시 만들어줌).

-- 재사용할 매칭 조건. 네 텍스트 필드를 한 덩어리로 합쳐 검사한다.
--   법령 인용 표준 표기 「…법…」 / 「…에 관한 법률」, 조·항·호, 하위법령, 판례 신호,
--   벌칙/과태료 등. law_amendment_note가 있으면(프롬프트상 법 문항에만 채움) 무조건 포함.
-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ STEP 1 — 삭제 대상 건수 먼저 확인 (아무것도 지우지 않음)                   │
-- └─────────────────────────────────────────────────────────────────────────┘
select count(*) as 삭제대상
from question_explanations qe
where
  qe.law_amendment_note is not null
  or qe.current_answer_status is not null   -- 새 스키마로 이미 법 문항 표시된 것
  or concat_ws(' ',
       qe.keyword_title, qe.keyword_explanation,
       qe.correct_choice_summary, qe.choice_explanations::text)
     ~ '「[^」]{0,30}법[^」]{0,25}」|에\s*관한\s*법률|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호|시행령|시행규칙|판례|대법원|헌법재판소|위헌|합헌|판시|동법|같은\s*법|과태료|벌칙|처벌|법령상|법적\s*근거';


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ STEP 2 — 백업 (되돌릴 수단 없이 지우지 말 것)                             │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 매칭된 행만 통째로 백업. 문제가 생기면 이 테이블에서 insert ... select로 복원 가능.
create table if not exists question_explanations_backup_20260712 as
select qe.*
from question_explanations qe
where
  qe.law_amendment_note is not null
  or qe.current_answer_status is not null
  or concat_ws(' ',
       qe.keyword_title, qe.keyword_explanation,
       qe.correct_choice_summary, qe.choice_explanations::text)
     ~ '「[^」]{0,30}법[^」]{0,25}」|에\s*관한\s*법률|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호|시행령|시행규칙|판례|대법원|헌법재판소|위헌|합헌|판시|동법|같은\s*법|과태료|벌칙|처벌|법령상|법적\s*근거';

select count(*) as 백업건수 from question_explanations_backup_20260712;
-- STEP 1의 삭제대상과 백업건수가 일치하는지 반드시 확인하고 다음으로.


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ STEP 3 — 비매칭 감사: "안 걸린 쪽"에 법 문항이 새는지 눈으로 확인          │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 정규식에 안 걸린 해설을 과목 섞어서 무작위로 뽑아, 법 문항이 빠져나갔는지 점검.
-- 새는 패턴이 보이면 위 정규식에 토큰을 추가하고 STEP 1부터 다시.
-- (order by random()은 표본용으로만 — 대량이면 limit로 충분.)
select qe.id, s.name as 과목, qe.keyword_title, qe.correct_choice_summary
from question_explanations qe
join questions q on q.id = qe.question_id
join exam_papers p on p.id = q.paper_id
join subjects s on s.id = p.subject_id
where
  qe.law_amendment_note is null
  and qe.current_answer_status is null
  and concat_ws(' ',
       qe.keyword_title, qe.keyword_explanation,
       qe.correct_choice_summary, qe.choice_explanations::text)
     !~ '「[^」]{0,30}법[^」]{0,25}」|에\s*관한\s*법률|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호|시행령|시행규칙|판례|대법원|헌법재판소|위헌|합헌|판시|동법|같은\s*법|과태료|벌칙|처벌|법령상|법적\s*근거'
order by random()
limit 60;


-- ┌─────────────────────────────────────────────────────────────────────────┐
-- │ STEP 4 — 실제 삭제 (STEP 1~3 확인 완료 후에만)                            │
-- └─────────────────────────────────────────────────────────────────────────┘
-- 배치는 "해설 없는 문항"을 다음 대상으로 잡으므로, 삭제하면 새 프롬프트로 재큐잉된다.
delete from question_explanations qe
where
  qe.law_amendment_note is not null
  or qe.current_answer_status is not null
  or concat_ws(' ',
       qe.keyword_title, qe.keyword_explanation,
       qe.correct_choice_summary, qe.choice_explanations::text)
     ~ '「[^」]{0,30}법[^」]{0,25}」|에\s*관한\s*법률|제\s*\d+\s*조|제\s*\d+\s*항|제\s*\d+\s*호|시행령|시행규칙|판례|대법원|헌법재판소|위헌|합헌|판시|동법|같은\s*법|과태료|벌칙|처벌|법령상|법적\s*근거';

-- 삭제 후 확인. 나중에 정리하려면: drop table question_explanations_backup_20260712;
