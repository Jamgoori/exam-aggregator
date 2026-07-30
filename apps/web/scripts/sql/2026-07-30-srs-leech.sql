-- leech(상습범) 접어두기 (2026-07-30)
--
-- SRS_LEECH_THRESHOLD(8)번 무너진 문항은 자동으로 접는다(Anki의 suspend + leech 태그와
-- 같은 자리, 기준값도 같다). 접힌 문항은 복습 큐에서도 대기 풀에서도 빠진다.
--
-- 필요한 이유: 우선순위 점수가 lapses에 비례하다 보니(min(연체,14) + lapses*3),
-- 방치하면 안 풀리는 문항 몇 개가 매일 큐 앞자리를 영구 점유한다. 거기에 당일 재확인이
-- 붙어 하루 서너 번씩 같은 문제가 나오고, 사용자는 "매일 같은 문제만 나온다"를 겪다가
-- 그만둔다. 그 문항의 문제는 간격이 아니라 이해라, 큐에서 빼고 해설을 보게 하는 게 맞다.
--
-- 다시 넣으면 lapses는 그대로 두고(진도 유지) 4번 더 무너질 때 다시 접힌다(8 → 12 → 16).
-- 스케줄(srs_due_at)도 지우지 않는다.
--
-- 적용: Supabase SQL Editor에서 실행. 기존 행은 null(정상)로 남는다 — 이미 8번 넘게
-- 무너진 문항이 있어도 소급 적용하지 않는다. 다음에 또 틀릴 때 판정에 걸린다.

alter table user_question_status add column if not exists srs_suspended_at timestamptz;
