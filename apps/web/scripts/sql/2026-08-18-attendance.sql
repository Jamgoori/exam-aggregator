-- 출석 보상: 문제를 푼 날을 하루 단위로 모아, 그 달의 출석 일수가 단계(5·10·15·20·25)에
-- 닿을 때마다 멤버십 기간을 붙여준다.
--
-- 설계 근거는 packages/core/src/attendance.ts 머리말에 있다. 요약하면:
--   · 연속이 아니라 누적이다(한 번 놓쳐도 그 달을 포기하지 않게).
--   · "접속"이 아니라 "채점된 문항 10개 이상"이 출석이다(데이터가 안 쌓이면 의미 없음).
--   · 단계 마지막이 월 개근이 아니라 25일이다(모든 달이 같은 기준 + 실제로 도달 가능).
--
-- 이 파일은 supabase/schema.sql 에 반영된 것과 같은 내용이다(운영 DB 에 1회 적용용).

-- ── 멤버십 출처에 'attendance' 추가 ─────────────────────────────────────────
-- 출석 보상으로 열린 기간을 체험·결제와 구분한다. 구분하지 않으면 체험이 끝난 무료
-- 회원이 1일권을 받는 순간 화면이 "무료 체험 중 · 1일 남음"을 띄운다(거짓말이고,
-- 복습 카드의 D-3 경고까지 되살아난다). 근거는 packages/core/src/membership.ts 의
-- MembershipSource 주석.
alter table memberships drop constraint if exists memberships_source_check;
alter table memberships add constraint memberships_source_check
  check (source in ('trial', 'paid', 'attendance'));

-- ── 출석 일자 ────────────────────────────────────────────────────────────────
-- 하루 한 행. question_count 는 그날 채점된 문항의 누계다(CBT·복습·섞어풀기 합산).
--
-- attend_date 는 KST 달력 날짜다(timestamptz 가 아니라 date). 서버가 어느 시간대에
-- 떠 있든 사용자가 보는 하루와 같아야 하고, 그 변환은 앱에서 이미 끝내서 넘긴다.
--
-- qualified_at: 문항 수가 기준(10개)을 처음 넘은 시각. 이 컬럼이 null 이 아닌 날만
-- 출석 일수로 센다. "10개를 넘겼는가"를 매번 question_count 로 다시 판정하지 않고
-- 못박아 두는 이유는, 나중에 기준을 바꿔도 **이미 인정한 출석이 취소되지 않게**
-- 하려는 것이다. 기준을 올렸더니 지난달 도장이 사라지는 건 사고다.
create table if not exists attendance_days (
  user_id uuid not null references auth.users(id) on delete cascade,
  attend_date date not null,
  question_count int not null default 0,
  qualified_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, attend_date)
);

-- 월간 카드가 "이 달 + 이 사용자"로만 훑는다.
create index if not exists attendance_days_user_month_idx
  on attendance_days(user_id, attend_date desc);

alter table attendance_days enable row level security;

drop policy if exists "select own attendance" on attendance_days;
create policy "select own attendance" on attendance_days
  for select to authenticated using (auth.uid() = user_id);

-- 쓰기 정책은 의도적으로 없다: 클라이언트가 question_count 를 직접 올릴 수 있으면
-- 문제를 안 풀고도 출석이 되고, 그대로 멤버십 기간으로 환전된다. 쓰기는 아래
-- record_attendance_day(security definer) 를 통해 서버 채점 경로에서만 일어난다.

-- ── 지급 원장 ────────────────────────────────────────────────────────────────
-- "이 사용자에게 이 달의 이 단계를 이미 줬다"를 못박는다. 기본키가 곧 멱등키다 —
-- 같은 단계를 두 번 주지 않는 것이 이 테이블의 존재 이유 전부다.
--
-- 왜 원장이 따로 필요한가: 멤버십 만료일(memberships.expires_at)만 봐서는 "그 날짜가
-- 출석으로 밀린 것인지 결제로 밀린 것인지"를 알 수 없다. 재시도·동시 채점이 겹치면
-- 같은 단계로 기간이 두 번 붙는데, 붙은 뒤에는 되돌릴 근거가 남지 않는다.
create table if not exists attendance_grants (
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 그 달의 1일(KST). 예: 2026-08-01.
  month date not null,
  -- 단계의 기준 일수(5·10·15·20·25). 단계 자체의 정의는 core 에 있고 여기엔 값만 남는다.
  milestone int not null,
  -- 실제로 부여한 멤버십 일수. 단계 정의가 나중에 바뀌어도 "그때 얼마를 줬는지"는
  -- 이 값으로 남는다 — 문의 대응 때 지어내지 않으려는 것.
  granted_days int not null,
  -- 이 지급으로 밀린 만료 시각. 사후에 "언제 얼마나 밀렸나"를 확인할 수 있게 남긴다.
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  primary key (user_id, month, milestone)
);

create index if not exists attendance_grants_user_month_idx
  on attendance_grants(user_id, month desc);

alter table attendance_grants enable row level security;

drop policy if exists "select own attendance grants" on attendance_grants;
create policy "select own attendance grants" on attendance_grants
  for select to authenticated using (auth.uid() = user_id);

-- 쓰기 정책 없음 — 같은 이유(직접 올릴 수 있으면 결제 없이 기간이 늘어난다).

-- ── 출석 기록 ────────────────────────────────────────────────────────────────
-- 채점된 문항 수를 그날 누계에 더하고, 기준을 넘겼으면 출석으로 확정한 뒤, 그 달의
-- 출석 일수를 돌려준다.
--
-- 누계 증분(count = count + n)이라 PostgREST upsert 로는 못 한다(산술 불가). 조회 후
-- 갱신으로 나누면 같은 초에 두 세션을 제출했을 때 한쪽이 덮어써서 문항이 증발하므로,
-- insert ... on conflict do update 한 문장으로 원자적으로 더한다.
--
-- p_min_questions 를 인자로 받는 이유: 기준값의 정본은 core 의 ATTENDANCE_MIN_QUESTIONS
-- 하나다. 여기에 10 을 적어두면 core 를 고쳤을 때 DB 만 옛 기준으로 남는다.
create or replace function record_attendance_day(
  p_user_id uuid,
  p_date date,
  p_questions int,
  p_min_questions int
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days int;
begin
  if p_questions is null or p_questions <= 0 then
    -- 채점된 문항이 없으면 아무것도 하지 않는다. 그래도 이 달의 출석 일수는
    -- 돌려준다 — 호출부가 "지금 몇 일째인가"를 이 함수 하나로 알게 하려는 것.
    select count(*) into v_days
      from attendance_days
     where user_id = p_user_id
       and attend_date >= date_trunc('month', p_date)::date
       and attend_date < (date_trunc('month', p_date) + interval '1 month')::date
       and qualified_at is not null;
    return v_days;
  end if;

  insert into attendance_days (user_id, attend_date, question_count, qualified_at, updated_at)
  values (
    p_user_id,
    p_date,
    p_questions,
    case when p_questions >= p_min_questions then now() end,
    now()
  )
  on conflict (user_id, attend_date) do update
    set question_count = attendance_days.question_count + excluded.question_count,
        -- 한 번 인정한 출석은 다시 끄지 않는다(coalesce 로 기존 값 보존).
        qualified_at = coalesce(
          attendance_days.qualified_at,
          case
            when attendance_days.question_count + excluded.question_count >= p_min_questions
            then now()
          end
        ),
        updated_at = now();

  select count(*) into v_days
    from attendance_days
   where user_id = p_user_id
     and attend_date >= date_trunc('month', p_date)::date
     and attend_date < (date_trunc('month', p_date) + interval '1 month')::date
     and qualified_at is not null;

  return v_days;
end $$;

-- ── 단계 지급 ────────────────────────────────────────────────────────────────
-- 한 단계를 딱 한 번 지급하고, 멤버십 만료일을 그만큼 뒤로 민다.
--
-- 반환값:
--   'applied'   — 이번 호출로 지급했다.
--   'already'   — 이미 준 단계다(원장 기본키 충돌). 재시도·동시 채점의 정상 경로.
--   'unlimited' — 만료 없는 프리미엄(expires_at is null)이라 붙일 자리가 없다.
--   'no_membership' — 멤버십 행이 없다(트리거 이전 가입 등).
--
-- 만료일을 미는 규칙은 결제(payment.ts 의 grantedExpiry)와 같은 "남은 기간 뒤에 이어
-- 붙이기"다. 지금 시각과 기존 만료 중 **늦은 쪽**을 기준으로 삼는다:
--   · 무료 회원(만료 없음/이미 지남)  → 지금부터 N일
--   · 체험·구독 중                     → 남은 기간이 끝난 뒤 N일
-- 이어 붙이지 않고 "지금부터 N일"로 덮어쓰면, 1년 구독자가 출석 보상을 받는 순간
-- 남은 구독이 통째로 사라진다. 보상이 강탈이 되는 실수라 여기서만 계산한다.
--
-- expires_at is null 인 프리미엄(만료 없음 = 정기결제)은 건드리지 않고 지급도 하지
-- 않는다. coalesce(expires_at, now()) 로 날짜를 박으면 무기한이던 계정이 유한해져,
-- 늘려주려던 보상이 오히려 뺏는다. 지급을 원장에 남기지 않으므로 그 계정이 유한한
-- 만료를 갖게 되면 다시 대상이 된다.
--   ⚠ 지금 코드에는 premium + expires_at is null 을 만드는 경로가 없다(체험도 결제도
--     날짜를 박는다). 정기결제를 붙일 때 이 분기를 다시 볼 것 — 그때는 "쌓아뒀다가
--     해지 시점에 흡수"가 필요해진다.
create or replace function grant_attendance_membership(
  p_user_id uuid,
  p_month date,
  p_milestone int,
  p_days int
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_membership memberships%rowtype;
  v_expires timestamptz;
  v_source text;
begin
  if p_days is null or p_days <= 0 then return 'already'; end if;

  -- 멤버십 행을 먼저 잠근다. 같은 사용자의 지급이 겹치면 여기서 줄을 서므로,
  -- 뒤엣것은 앞엣것이 민 만료일을 보고 그 뒤에 이어 붙인다(덮어쓰지 않는다).
  select * into v_membership from memberships where user_id = p_user_id for update;
  if not found then return 'no_membership'; end if;

  if v_membership.tier = 'premium' and v_membership.expires_at is null then
    return 'unlimited';
  end if;

  -- 남은 기간 뒤에 이어 붙인다. 만료가 이미 지난 계정은 now() 가 기준이 된다.
  v_expires := greatest(coalesce(v_membership.expires_at, now()), now())
               + make_interval(days => p_days);

  -- 기간의 출처. 화면 문구가 여기서 갈린다(core 의 MembershipSource 주석 참고).
  --   · 남은 기간이 있으면 그대로 둔다 — 체험 중에 받은 하루는 체험의 연장이고,
  --     "체험 N일 남음" 안내가 계속 맞아야 한다. 구독자도 마찬가지로 'paid' 다.
  --   · 남은 기간이 없는(= 무료) 상태에서 받은 것만 'attendance' 다. 이걸 'trial' 로
  --     두면 체험이 끝난 회원에게 "무료 체험 중 · 1일 남음"이 떠서 거짓말이 된다.
  --   · 아직 체험을 시작하지 않은 계정(started_at is null)은 손대지 않는다. source 를
  --     바꾸면 start_trial_if_eligible 의 where 절(source='trial')에 안 걸려 60일을
  --     영영 못 받는다. 실제로는 채점 경로가 이미 체험을 켜므로 오지 않는 분기지만,
  --     여기서 막지 않으면 순서가 바뀌었을 때 조용히 체험을 뺏는다.
  v_source := case
    when v_membership.expires_at is not null and v_membership.expires_at > now()
      then v_membership.source
    when v_membership.started_at is null then v_membership.source
    else 'attendance'
  end;

  -- 원장이 멱등키다. 같은 단계로 동시에 들어온 두 요청 중 뒤엣것은 여기서 충돌해
  -- 0행이 되고(found = false), 멤버십은 한 번만 밀린다.
  insert into attendance_grants (user_id, month, milestone, granted_days, expires_at)
  values (p_user_id, p_month, p_milestone, p_days, v_expires)
  on conflict (user_id, month, milestone) do nothing;

  if not found then return 'already'; end if;

  update memberships
     set tier = 'premium',
         expires_at = v_expires,
         source = v_source,
         -- 무료 기간을 아직 시작하지 않은 계정(started_at is null)의 started_at 은
         -- 여기서 켜지 않는다 — 출석으로 받은 며칠이 60일 체험의 시작으로 오해되면
         -- 안 된다. 체험은 start_trial_if_eligible 만 켠다.
         updated_at = now()
   where user_id = p_user_id;

  return 'applied';
end $$;

-- ⚠ 두 함수 모두 security definer 라 RLS 를 우회한다. 로그인한 사용자가 REST 로 직접
-- 부를 수 있으면 문제를 안 풀고도 출석·기간이 생기므로 실행 권한을 service_role 로만
-- 좁힌다(결제 함수와 같은 처리).
revoke all on function record_attendance_day(uuid, date, int, int) from public, anon, authenticated;
revoke all on function grant_attendance_membership(uuid, date, int, int) from public, anon, authenticated;
grant execute on function record_attendance_day(uuid, date, int, int) to service_role;
grant execute on function grant_attendance_membership(uuid, date, int, int) to service_role;
