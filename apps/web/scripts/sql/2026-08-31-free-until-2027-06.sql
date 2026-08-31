-- 전면 무료 이벤트: 2027-06-30(KST)까지 모든 계정에 멤버십.
--
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다(운영 DB 에 1회 적용용).
-- 여러 번 실행해도 안전하다 — 이미 이벤트 종료일까지 열린 행은 조건에 걸리지 않고,
-- 이벤트가 끝난 뒤에는 맨 앞의 now() 검사가 통째로 막는다.
--
-- 판정 자체(기간 중에는 계정과 무관하게 프리미엄)는 코드가 이미 한다:
--   packages/core/src/membership.ts        isFreeForAll / FREE_UNTIL
--   supabase/functions/_shared/membership.ts  같은 값의 Deno 포팅본
-- 그래서 이 SQL 을 적용하지 않아도 기능은 열린다. 그래도 적용하는 이유는 마이페이지·
-- 결제 화면이 memberships 를 그대로 읽어 "지금 내 상태"를 보여주기 때문이다 —
-- 열려 있는데 "현재 무료 회원"이라고 적혀 있으면 문의가 온다.

-- ── 전면 무료 이벤트: 2027-06-30(KST)까지 모두 멤버십 ────────────────────────
-- 이벤트 기간에는 코드가 계정을 보지 않고 프리미엄으로 판정한다(packages/core 의
-- isFreeForAll — 웹·앱·Edge Function 모두 같은 자리에 같은 검사가 있다). 그래도
-- 여기서 행까지 맞춰두는 이유는 마이페이지·결제 화면이 memberships 를 그대로 읽어
-- "지금 내 상태"를 보여주기 때문이다 — 기능은 열려 있는데 "현재 무료 회원"이라고
-- 적혀 있으면 문의가 온다.
--
-- 앞으로 가입하는 사람은 여기 오지 않는다: start_trial_if_eligible 에 넘어오는
-- 만료일이 이미 이벤트 종료일이다(웹·앱의 trialExpiresAt). 이 블록의 대상은 이
-- 배포 시점에 이미 가입해 있던 계정들이다.
--
-- 이벤트가 끝난 뒤 이 파일을 다시 적용해도 아무 일도 일어나지 않게 now() 로 막는다.
do $$
declare
  v_until constant timestamptz := timestamptz '2027-07-01 00:00:00+09';
begin
  if now() >= v_until then return; end if;

  -- 1) 행이 아예 없는 계정(멤버십 트리거 이전 가입 등). 이 사람들은 UPDATE 로는
  --    닿지 않아서, 화면이 DB 를 읽는 자리마다 계속 "무료 회원"으로 보인다.
  insert into memberships (user_id, tier, source, started_at, expires_at)
  select u.id, 'premium', 'trial', now(), v_until
    from auth.users u
    left join memberships m on m.user_id = u.id
   where m.user_id is null
  on conflict (user_id) do nothing;

  -- 2) 이미 있는 행은 이벤트 종료일까지 늘린다.
  --    건드리지 않는 것: 만료 없는 프리미엄(정기결제 — 날짜를 박으면 무기한이
  --    기한제로 강등된다)과, 이벤트 종료일보다 뒤까지 이미 열려 있는 장기 결제자.
  --    source 는 그대로 둔다 — 결제자는 'paid' 로 남아야 결제 이력·화면 문구가 맞고,
  --    체험 원장(trial_consumptions)도 그대로라 이벤트가 끝나면 예전 규칙으로
  --    정확히 돌아간다.
  update memberships
     set tier = 'premium',
         -- 아직 체험이 시작되지 않은 계정(started_at is null)은 지금 시작한 것으로
         -- 본다. 비워두면 조회 경로가 매번 start_trial_if_eligible 을 다시 부른다.
         started_at = coalesce(started_at, now()),
         expires_at = v_until,
         updated_at = now()
   where tier <> 'premium'
      or (expires_at is not null and expires_at < v_until);
end $$;
