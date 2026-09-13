-- 해설 배치 큐: 한능검 우선, 해경 정지 (2026-09-13)
--
-- 요청: "해경은 후순위로 미루고 한능검부터 시작". 실행 시점 실측
-- (`node --env-file=.env.local scripts/explanation-queue-status.mjs`):
--
--   기존 20개 그룹 중 잔여가 있는 것은 해경 하나뿐 — 전체 19,760 / 완료 14,030 / 잔여 5,730.
--   한능검(심화, 문제지 30장·문항 1,500개)은 큐에 행이 없어 통째로 빠져 있었다(해설 0건).
--
-- 큐에 없는 (exam_type_id, level) 조합은 배치가 영원히 건너뛴다. 그래서 한능검을 등록하고
-- 해경을 뺀다. 아래 두 가지 제약 때문에 "한능검 행 하나 추가"로는 요청을 만족할 수 없었다:
--
-- 1. `explanation_batch_priority_exam_type_id_level_key`(exam_type_id, level 유니크)가 있어
--    한 그룹을 큐 앞뒤 양쪽에 둘 수 없다. 순방향은 priority 오름차순, 역방향은 내림차순으로
--    순회하므로(next-explanation-chunk.mjs), 한능검 행이 하나면 두 루틴 중 한쪽만 한능검을
--    먼저 집고 다른 쪽은 해경을 계속 판다. 두 루틴 모두 한능검에 붙이려면 해경 행을 빼는
--    수밖에 없다.
-- 2. 완료된 그룹의 행을 남겨두면 역방향 루틴이 매 배치마다 그 그룹들의 문제지를 전부
--    훑고 나서야 한능검(priority 0)에 도달한다 — 실측으로 한 번 호출에 10분 이상(문제지
--    4,800여 장 × 문항/해설 조회 2회씩)이 걸렸다. 잔여 0인 그룹 행을 전부 빼니 같은
--    호출이 3.5초로 떨어졌다. 그래서 큐를 한능검 한 줄만 남긴다.
--
-- 즉 지금 큐는 "한능검 전용" 상태다. 순방향은 50회 #1부터, 역방향은 77회 #50부터 좁혀온다.
--
-- ⚠ 한능검 1,500문항이 끝나면 두 루틴 다 `done:true`로 즉시 종료하고 큐가 논다.
--   그때 아래 "복구" 절을 실행해서 해경(priority 19)과 나머지 19개 그룹을 되돌릴 것.
--   `node --env-file=.env.local scripts/explanation-queue-status.mjs` 의
--   "큐에 등록되지 않은 그룹" 경고가 그 알림 역할을 한다 (지금은 19개 그룹이 거기 뜬다).
--
-- 실행은 소유자 계정(service role)으로 했다. 재실행해도 안전하다.

-- ── 적용한 변경 ────────────────────────────────────────────────────────────────

-- (1) 한능검(심화)을 맨 앞에 등록
insert into explanation_batch_priority (priority, exam_type_id, level)
select 0, t.id, '심화'
from exam_types t
where t.name = '한능검'
  and not exists (
    select 1 from explanation_batch_priority p
    where p.exam_type_id = t.id and p.level = '심화'
  );

-- (2) 한능검을 제외한 모든 행 삭제 (해경 = 유일한 잔여 그룹, 나머지 19개 = 잔여 0)
delete from explanation_batch_priority
where exam_type_id <> (select id from exam_types where name = '한능검');

-- 확인: 1행, 한능검 심화 priority 0 이어야 한다.
select p.priority, t.name, p.level
from explanation_batch_priority p
join exam_types t on t.id = p.exam_type_id
order by p.priority;

-- ── 복구 (한능검이 끝난 뒤 실행) ───────────────────────────────────────────────
--
-- 삭제 직전 상태 그대로 되돌린다. 해경은 원래 자리인 priority 19 로 돌아가고,
-- 2026-09-03 에 정해둔 순서(소방 20 이 맨 뒤, 5급 3종이 13~15 정중앙)를 유지한다.
-- 한능검(0)은 그대로 두면 되고, 다 끝난 그룹이라 앞에 있어도 스캔 비용은 거의 없다.
-- 아래 블록의 주석(`/* ... */`)을 벗기고 실행할 것.
--
/*
insert into explanation_batch_priority (priority, exam_type_id, level)
select v.priority, t.id, v.level
from (values
  ( 1, '지방직',   '9급'),
  ( 2, '국가직',   '9급'),
  ( 3, '국가직',   '7급'),
  ( 4, '지방직',   '7급'),
  ( 5, '경력경쟁', '9급'),
  ( 6, '지역인재', '9급'),
  ( 7, '법원직',   '9급'),
  ( 8, '기상직',   '9급'),
  ( 9, '국회직',   '8급'),
  (10, '군무원',   '7급'),
  (11, '기상직',   '7급'),
  (12, '계리직',   null),
  (13, '국가직',   '5급'),
  (14, '국회직',   '5급'),
  (15, '법원직',   '5급'),
  (16, '국회직',   '9급'),
  (17, '군무원',   '9급'),
  (18, '경찰',     null),
  (19, '해경',     null),
  (20, '소방',     null)
) as v(priority, exam_type, level)
join exam_types t on t.name = v.exam_type
on conflict (exam_type_id, level) do nothing;

-- 확인: 21행이어야 하고, 해경이 19 에 있어야 한다.
select p.priority, t.name, p.level
from explanation_batch_priority p
join exam_types t on t.id = p.exam_type_id
order by p.priority;
*/
