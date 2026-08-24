-- 누적 다운로드를 봇이 섞이지 않은 값에서 다시 시작한다 (2026-08-24) — **선택 사항**
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- exam_papers.download_count 는 /download/[id] 가 요청을 가리지 않고 올려 온 값이다.
-- 그 라우트는 로그인을 보지 않고 increment_download_count 도 anon 에 열려 있어서,
-- robots.txt(/download disallow)를 무시하는 크롤러가 문제지 상세의 링크를 따라오기만
-- 해도 카운트가 올라갔다. "사용자가 없는 6일 동안 함수 호출 103만 건"이 찍힌 적이
-- 있으니(robots.ts 주석) 지금 값에 봇이 얼마나 섞여 있는지는 알 방법이 없다.
--
-- 앞으로 들어올 요청은 lib/download-counting.ts 가 걸러서 사람이 누른 것만 센다.
-- 다만 **이미 쌓인 값은 되돌릴 수 없다** — 요청별 로그를 남긴 적이 없어서 사람 몫과
-- 봇 몫을 사후에 분리할 수 없다. 그래서 숫자를 "사람 것"으로 만들려면 한 번 0 에서
-- 다시 시작하는 수밖에 없다.
--
-- ── 돌릴지 말지 ─────────────────────────────────────────────────────────────
--
-- 돌린다  : 홈의 "누적 다운로드"가 며칠간 아주 작은 숫자로 보이지만, 그 뒤로는 진짜다.
-- 안 돌린다: 숫자는 커 보이지만 영영 "과거의 봇 + 앞으로의 사람"이 섞인 값이다.
--
-- 급하지 않다. 며칠 새 값(사람만 센 증가분)을 지켜본 뒤에 정해도 된다.
--
-- ── 되돌리는 법 ─────────────────────────────────────────────────────────────
--
-- 0 으로 만들기 전에 원래 값을 백업 테이블에 그대로 남긴다. 마음이 바뀌면 파일 맨 아래
-- 롤백 문장 하나로 되돌아간다. 백업 테이블은 이 작업 전용이라 schema.sql 에는 없다.

begin;

-- 이미 돌린 적이 있으면 여기서 멈춘다 — 두 번 돌리면 백업이 "0 으로 덮인 값"이 돼서
-- 되돌릴 수 없게 된다.
do $$
begin
  if to_regclass('public.download_count_backup_20260824') is not null then
    raise exception '이미 적용됨: download_count_backup_20260824 가 있다. 되돌리려면 파일 아래 롤백 문장을 쓸 것';
  end if;
end $$;

create table download_count_backup_20260824 as
  select id as paper_id, download_count, now() as backed_up_at
  from exam_papers;

update exam_papers set download_count = 0 where download_count <> 0;

commit;

-- 확인: 백업 합계(= 예전 누적)와 지금 합계(= 0)
--   select sum(download_count) from download_count_backup_20260824;
--   select total_download_count();

-- ── 롤백 ────────────────────────────────────────────────────────────────────
-- 되돌리려면 아래를 실행한다. 덮어쓰지 않고 **더한다** — 초기화 이후에 쌓인 값은
-- 사람이 누른 진짜 다운로드라, 되돌린다고 그것까지 지우면 안 된다.
-- 되돌린 뒤 다시 초기화하려면 백업 테이블을 먼저 지운다.
--
--   update exam_papers p
--      set download_count = p.download_count + b.download_count
--     from download_count_backup_20260824 b
--    where p.id = b.paper_id;
--
--   drop table download_count_backup_20260824;
