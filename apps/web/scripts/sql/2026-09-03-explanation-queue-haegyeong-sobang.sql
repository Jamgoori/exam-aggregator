-- 해설 배치 큐에 해경·소방 등록 (2026-09-03)
--
-- 2026-09-03 실측: 큐(explanation_batch_priority)에 등록된 18개 그룹은 잔여 0으로
-- 전부 처리가 끝났다(순방향·역방향 next-explanation-chunk.mjs 둘 다 done:true).
-- 그런데 exam_papers 에는 있으나 큐에 행이 없는 그룹이 두 개 남아 있었다:
--
--   해경 (급수 없음) — 문제지 772장, 문항 20,160개, 해설 0건
--   소방 (급수 없음) — 문제지 277장, 문항  5,535개, 해설 0건
--
-- 큐에 없는 (exam_type_id, level) 조합은 배치가 영원히 건너뛴다. 그래서 이 두 그룹을
-- 등록한다. 등록 후 큐는 18행 → 20행.
--
-- 우선순위: 해경 19, 소방 20.
--   순방향 루틴은 1번부터, 역방향 루틴은 마지막 번호부터 좁혀온다. 기존 18개 그룹은
--   잔여가 0이라 실제 작업은 이 두 그룹뿐이고, 역방향이 소방(5,535)을 끝낸 뒤 해경을
--   뒤에서부터 먹으므로 두 방향은 해경 안쪽에서 만난다. 앞뒤 몫이 대략 절반씩으로
--   갈려서 별도의 "정중앙 배치" 조정이 필요 없다.
--
-- level 은 NULL 이다(급수 없는 직렬). next-explanation-chunk.mjs 는 NULL 이면
-- .eq() 대신 .is() 로 문제지를 거른다 — 이 컬럼의 NOT NULL 은 2026-08-09에 이미
-- 해제돼 있다.
--
-- 실행: 소유자 계정으로 supabase db query --linked (또는 service role 접속).
-- 재실행해도 안전하다 (이미 있으면 아무것도 넣지 않는다).

insert into explanation_batch_priority (priority, exam_type_id, level)
select 19, t.id, null
from exam_types t
where t.name = '해경'
  and not exists (
    select 1 from explanation_batch_priority p
    where p.exam_type_id = t.id and p.level is null
  );

insert into explanation_batch_priority (priority, exam_type_id, level)
select 20, t.id, null
from exam_types t
where t.name = '소방'
  and not exists (
    select 1 from explanation_batch_priority p
    where p.exam_type_id = t.id and p.level is null
  );

-- 확인: 20행이어야 하고, 마지막 두 행이 해경(19)·소방(20)이어야 한다.
select p.priority, t.name, p.level
from explanation_batch_priority p
join exam_types t on t.id = p.exam_type_id
order by p.priority;
