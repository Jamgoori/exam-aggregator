-- 탈퇴 후 재가입자에게 무료 기간을 다시 주지 않는다 (2026-08-15)
--
-- ── 무엇이 문제였나 ─────────────────────────────────────────────────────────
--
-- 무료 기간(60일)은 "계정당 한 번"이 전제인데, 실제로는 **auth.users 행당 한 번**이었다.
-- memberships.started_at 으로만 판정하고, 그 행은 탈퇴할 때 계정과 함께 cascade 로
-- 사라지기 때문이다. 같은 사람이 탈퇴 → 같은 소셜 계정으로 재가입하면 새 user_id 가
-- 발급되고 memberships 행도 새로 만들어져서(started_at = null) 60일이 다시 켜진다.
-- 몇 번이고 반복할 수 있으므로, 결제할 이유가 없어진다.
--
-- ── 어떻게 막나 ─────────────────────────────────────────────────────────────
--
-- "이 사람은 이미 무료 기간을 썼다"를 **계정과 별개로** 남겨야 한다. 계정에 붙여 두면
-- 계정과 같이 지워지므로 무슨 수를 써도 못 막는다. 그래서 trial_consumptions 라는
-- 원장을 따로 두고, auth.users 에 FK 를 걸지 않는다(걸면 다시 같이 지워진다).
--
-- 남기는 값은 **이메일의 SHA-256 해시**다. 이유:
--   · 이메일 원문을 남기면 "탈퇴하면 지운다"는 약속을 어기게 된다. 해시는 되돌릴 수
--     없으므로 "이 이메일이 전에 있었는지"만 확인할 수 있고 목록을 복원할 수 없다.
--   · 소셜 로그인(구글·카카오)만 받으므로 이메일이 곧 사람의 식별자다. 구글은 +별칭으로
--     계정을 새로 만들 수 없어서(OAuth 는 언제나 정규 주소를 준다) 별칭 우회도 안 통한다.
--   · 대소문자·앞뒤 공백만 정규화한다. 그 이상 정규화하면(점 제거 등) 서로 다른 사람을
--     같은 사람으로 묶어 무고한 신규 가입자의 체험을 뺏는다 — 그쪽 사고가 더 나쁘다.
--
-- 판정과 기록이 갈라지면 안 되므로(체험은 켰는데 원장에 안 남으면 무한 반복이 그대로
-- 남는다) 한 함수 안에서 같이 한다: start_trial_if_eligible.
--
-- ── 재가입자의 상태 ─────────────────────────────────────────────────────────
--
-- 체험을 거절할 때 memberships.started_at 에 지금 시각을 찍는다(tier 는 free 그대로,
-- expires_at 은 null 그대로). "이미 소진했다"를 행에 못박아 두는 것이다:
--   · 안 찍으면 started_at 이 영원히 null 이라 요청마다 이 함수를 다시 부른다.
--   · expires_at 을 과거로 찍으면 화면이 "체험 0일 남음"을 띄운다(trialDaysLeft 는
--     expires_at 이 null 이면 null 을 돌려주고, 값이 있으면 0 을 돌려준다).
-- 결과적으로 재가입자는 "무료 회원"으로만 보인다 — 체험이 끝난 사람과 같은 화면이다.
--
-- 적용: Supabase SQL Editor 에 이 파일을 붙여넣고 실행(재실행 안전).
--       정본은 supabase/schema.sql 에도 같은 내용으로 들어가 있다.

-- ── 원장 ────────────────────────────────────────────────────────────────────

create table if not exists trial_consumptions (
  -- sha256('gongmoa:trial:' || lower(trim(email))) 의 hex. 원문은 남기지 않는다.
  email_hash text primary key,
  consumed_at timestamptz not null default now()
);

-- auth.users 에 FK 를 걸지 않는다. 걸면 탈퇴할 때 이 행도 같이 지워져서
-- 이 테이블이 존재하는 이유가 사라진다.

alter table trial_consumptions enable row level security;
-- 정책을 만들지 않는다 = 아무도 못 읽고 못 쓴다. 서버(service_role)만 접근한다.
-- 읽을 수 있으면 "이 이메일이 우리 서비스를 쓴 적 있는가"를 밖에서 대조할 수 있다.

-- ── 이메일 해시 ─────────────────────────────────────────────────────────────
--
-- sha256() 은 PostgreSQL 11+ 내장이라 pgcrypto 확장이 없어도 된다.
-- 이메일이 없는 계정(있어선 안 되지만)은 null 을 돌려주고, 호출부는 그때 원장 검사를
-- 건너뛴다 — 식별할 수 없다고 체험을 뺏으면 정상 가입자가 피해를 본다.
create or replace function trial_identity_hash(p_user_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select encode(
    sha256(convert_to('gongmoa:trial:' || lower(trim(u.email)), 'UTF8')),
    'hex'
  )
  from auth.users u
  where u.id = p_user_id
    and u.email is not null
    and trim(u.email) <> ''
$$;

-- ── 체험 시작(유일한 경로) ──────────────────────────────────────────────────
--
-- 웹(apps/web/src/lib/membership.ts)과 앱 Edge Function
-- (supabase/functions/_shared/membership.ts)이 둘 다 이 함수를 부른다. 예전에는 양쪽이
-- 각자 UPDATE 를 날렸는데, 그러면 원장 검사를 한쪽에만 넣는 실수가 언제든 가능하다.
--
-- 만료 시각은 앱이 계산해서 넘긴다(TRIAL_DAYS 의 정본은 packages/core). 결제 반영
-- 함수(apply_paid_membership)와 같은 규칙이다 — 날짜 계산을 SQL 로 한 벌 더 옮겨 적으면
-- 두 곳이 조용히 어긋난다.
--
-- 돌려주는 값: 실제로 켜졌을 때만 한 행(갱신된 memberships 행 그대로). 호출부가
-- "정말 켜졌는지"를 지어내지 않고 DB 가 돌려준 값으로 판단하게 하려는 것이다
-- (0행 = 안 켜짐).
--
-- returns table(tier, source, ...) 로 컬럼을 나열하지 않는다: 그렇게 하면 그 이름들이
-- OUT 파라미터가 되어, 함수 본문의 `where started_at is null` 이 컬럼인지 파라미터인지
-- 모호해져 실행 시점에 터진다. setof memberships 는 그 충돌 자체가 없다.
create or replace function start_trial_if_eligible(
  p_user_id uuid,
  p_expires_at timestamptz
)
returns setof memberships
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_row memberships%rowtype;
begin
  v_hash := trial_identity_hash(p_user_id);

  -- 이미 이 이메일로 무료 기간을 쓴 적이 있으면(= 탈퇴 후 재가입) 켜지 않는다.
  if v_hash is not null
     and exists (select 1 from trial_consumptions where email_hash = v_hash) then
    -- 소진 표시만 남기고 끝낸다. 위 머리말 "재가입자의 상태" 참고.
    update memberships
       set started_at = now(), updated_at = now()
     where user_id = p_user_id and source = 'trial' and started_at is null;
    return;
  end if;

  -- started_at is null 을 조건에 건 단일 UPDATE라 요청이 겹쳐도 두 번 시작되지 않는다
  -- (같은 행을 두고 줄을 서고, 두 번째는 0행 갱신이 된다).
  update memberships
     set tier = 'premium',
         started_at = now(),
         expires_at = p_expires_at,
         updated_at = now()
   where user_id = p_user_id and source = 'trial' and started_at is null
  returning * into v_row;

  -- 대상이 아니었다(이미 켰거나, 유료 계정이거나, 행이 없다). 원장도 건드리지 않는다.
  if not found then return; end if;

  -- 켠 뒤에 남긴다. 같은 트랜잭션이라 "체험은 켜졌는데 원장에는 없는" 상태가 없다.
  insert into trial_consumptions (email_hash)
  select v_hash
  where v_hash is not null
  on conflict (email_hash) do nothing;

  return next v_row;
end $$;

-- security definer 라 RLS 를 우회한다. 사용자가 직접 부를 수 있으면 원하는 만료일을
-- 넘겨 스스로 프리미엄이 된다 — 실행 권한을 회수하고 서버(service_role)에만 준다.
-- (Postgres 는 새 함수의 EXECUTE 를 PUBLIC 에 기본 부여한다.)
revoke all on function trial_identity_hash(uuid) from public, anon, authenticated;
revoke all on function start_trial_if_eligible(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function trial_identity_hash(uuid) to service_role;
grant execute on function start_trial_if_eligible(uuid, timestamptz) to service_role;

-- ── 기존 사용자 백필 ────────────────────────────────────────────────────────
--
-- 이걸 안 하면 지금까지 체험을 쓴 사람들은 원장에 없어서, 이 변경 뒤에 탈퇴하면
-- 한 번 더 받을 수 있다. 이미 켠 사람(started_at is not null)을 전부 채워 둔다.
insert into trial_consumptions (email_hash, consumed_at)
select encode(sha256(convert_to('gongmoa:trial:' || lower(trim(u.email)), 'UTF8')), 'hex'),
       min(m.started_at)
  from memberships m
  join auth.users u on u.id = m.user_id
 where m.started_at is not null
   and u.email is not null
   and trim(u.email) <> ''
 group by 1
on conflict (email_hash) do nothing;
