-- 결제 (2026-08-14)
--
-- 멤버십 유료 결제 기록 + 결제를 멤버십 기간으로 반영하는 함수. PG(토스페이먼츠)
-- 연동의 서버측 정본이다.
--
-- 설계 결정과 근거:
--
-- 1) order_id 가 기본키다 (PG 가 주는 payment_key 가 아니라).
--    주문번호는 결제창을 띄우기 "전에" 우리가 발급한다. payment_key 는 승인 시점에야
--    생기므로 그걸 키로 삼으면 결제창을 띄운 뒤 승인 전까지의 주문을 저장할 수 없다 —
--    그 구간이 비면 "결제창은 떴는데 우리 DB엔 흔적이 없는" 주문이 생기고, 사용자가
--    돈은 냈는데 우리는 뭘 승인해야 할지 모르는 상태가 된다.
--
-- 2) amount 를 주문 생성 시점에 서버가 박아둔다.
--    승인(confirm) 때 PG 가 알려준 금액과 이 값을 대조해서 다르면 승인하지 않는다.
--    이게 없으면 클라이언트가 결제창에 넘기는 금액을 5,900 → 100 으로 바꿔도 서버가
--    모른 채 승인해버린다. 금액 검증의 기준선이라 절대 클라이언트 입력으로 채우지 말 것.
--
-- 3) months 를 결제 시점에 함께 박아둔다.
--    기간 부여·회수는 이 값으로 계산한다. pricing.ts 의 요금제 정의를 그때그때 참조하면,
--    나중에 "3개월권"의 개월 수가 바뀌었을 때 옛 결제를 환불하면서 엉뚱한 기간을 빼게
--    된다. 결제는 그 시점의 조건으로 동결되어야 한다.
--
-- 4) status 와 granted_at 이 따로 있다.
--    status='paid' 는 "돈을 받았다", granted_at 은 "그 대가로 기간을 줬다"로 서로 다른
--    사건이다. 한 컬럼으로 합치면 둘 사이에서 실패했을 때(승인은 됐는데 멤버십 UPDATE 가
--    실패) 그 상태를 표현할 수가 없다. 나눠 두면 아래 한 줄로 사고를 찾아낼 수 있다:
--      select * from payments where status='paid' and granted_at is null;
--    (= 돈은 받았는데 기간을 못 준 주문. 비어 있어야 정상.)
--
-- 5) 쓰기 정책이 없다 (memberships 와 같은 이유).
--    status 를 클라이언트가 'paid' 로 올릴 수 있으면 결제 없이 프리미엄이 된다.
--    모든 쓰기는 서버(service_role)의 승인 경로·웹훅만 한다. 읽기는 본인 것만.

create table if not exists payments (
  -- 우리가 발급해 PG 에 그대로 넘기는 주문번호. 토스 제약: 6~64자, 영문/숫자/-/_.
  order_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- pricing.ts 의 PlanId ('monthly' | 'quarterly' | 'yearly').
  plan_id text not null,
  -- 이 결제로 부여할 개월 수. 요금제 정의가 바뀌어도 이 결제의 기간은 안 바뀐다.
  months int not null,
  -- 서버가 정한 결제 금액(원). 승인 때 PG 가 알려준 금액과 대조하는 기준.
  amount int not null,
  status text not null default 'ready',
  -- 결제대행사. 지금은 'toss' 하나지만, 나중에 옮기거나 병행할 때 옛 거래를
  -- 어디서 취소해야 하는지 알 수 있어야 한다.
  provider text not null default 'toss',
  -- PG 의 거래 식별자. 취소(환불)·재조회에 쓴다.
  payment_key text,
  -- 사용자에게 보여줄 표시용 값. 우리 화면이 PG 를 매번 조회하지 않아도 되게 저장한다.
  method text,
  receipt_url text,
  paid_at timestamptz,
  -- 이 결제로 멤버십 기간을 실제로 부여한 시각. 위 4) 참고.
  granted_at timestamptz,
  canceled_at timestamptz,
  -- 실패 사유(PG 가 준 코드/메시지). 문의 대응용이라 사람이 읽을 수 있게 남긴다.
  fail_reason text,
  -- PG 응답 원본. 분쟁이 나면 우리가 가공한 값이 아니라 이걸 봐야 한다.
  raw jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 이미 만들어 둔 환경에도 나중에 추가된 컬럼이 들어가게 한다(재실행 안전).
alter table payments add column if not exists granted_at timestamptz;

do $$ begin
  alter table payments add constraint payments_status_check
    check (status in ('ready', 'paid', 'failed', 'canceled'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table payments add constraint payments_amount_check check (amount > 0);
exception when duplicate_object then null; end $$;

do $$ begin
  alter table payments add constraint payments_months_check check (months > 0);
exception when duplicate_object then null; end $$;

-- 같은 PG 거래가 두 주문에 붙는 일은 있을 수 없다. 이게 뚫리면 승인 한 건으로
-- 기간을 두 번 받을 수 있다.
create unique index if not exists payments_payment_key_uidx
  on payments(payment_key) where payment_key is not null;

-- 내 결제 내역 화면(최신순).
create index if not exists payments_user_created_idx
  on payments(user_id, created_at desc);

alter table payments enable row level security;

drop policy if exists "select own payments" on payments;
create policy "select own payments" on payments
  for select to authenticated using (auth.uid() = user_id);

-- 쓰기 정책은 의도적으로 없다. 위 5) 참고.


-- ── 결제 → 멤버십 반영 ───────────────────────────────────────────────────────
--
-- 승인 성공 뒤에 할 일이 둘이다: payments.granted_at 을 찍고, memberships 를 늘린다.
-- 애플리케이션에서 두 번의 UPDATE 로 하면 그 사이에서 실패했을 때 둘 중 하나만 반영된
-- 상태가 남는다(기간은 늘었는데 부여 기록이 없으면 재시도 때 또 늘어난다 — 결제 한
-- 건으로 1년권을 두 번 받는 경로다). 한 트랜잭션 안에서 끝내려고 DB 함수로 둔다.
--
-- 동시성: 맨 앞의 `for update` 가 같은 주문에 대한 두 번째 호출(웹훅 ↔ 리다이렉트가
-- 겹치는 실제 상황)을 줄 세우고, granted_at 검사가 두 번째를 'already' 로 돌려보낸다.
--
-- 만료 시각(p_expires_at)은 앱이 계산해서 넘긴다. 날짜 계산 규칙(남은 기간에 이어
-- 붙이기·말일 처리)의 정본은 packages/core/src/payment.ts 하나이고, 그 규칙을 SQL 로
-- 한 번 더 옮겨 적으면 두 곳이 조용히 어긋난다.
create or replace function apply_paid_membership(
  p_order_id text,
  p_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments where order_id = p_order_id for update;

  if not found then return 'not_found'; end if;
  -- 돈을 받지 않은 주문에 기간을 주지 않는다. status 는 service_role 만 쓸 수 있으므로
  -- 이 검사가 "실제로 결제된 건인가"의 근거가 된다.
  if v_payment.status <> 'paid' then return 'not_paid'; end if;
  if v_payment.granted_at is not null then return 'already'; end if;

  -- 가입 트리거가 멤버십 행을 만들어 두지만, 트리거 이전에 가입한 계정 등 행이 없는
  -- 경우가 있다. 없으면 만든다 — 여기서 0행 갱신으로 끝나면 결제만 되고 기간은 안 준다.
  insert into memberships (user_id, tier, source, started_at, expires_at, updated_at)
  values (v_payment.user_id, 'premium', 'paid', now(), p_expires_at, now())
  on conflict (user_id) do update
    set tier = 'premium',
        source = 'paid',
        expires_at = excluded.expires_at,
        -- 무료 기간을 이미 시작한 계정의 시작 시각은 보존한다(이력).
        started_at = coalesce(memberships.started_at, excluded.started_at),
        updated_at = now();

  update payments set granted_at = now(), updated_at = now() where order_id = p_order_id;
  return 'applied';
end $$;

-- 전액 취소(환불) 반영. apply_paid_membership 의 역이고, 같은 이유로 한 트랜잭션이다.
--
-- 기간을 준 적이 없으면(granted_at is null) 멤버십은 건드리지 않고 주문만 취소로
-- 표시한다 — 주지도 않은 기간을 빼면 멀쩡한 무료 기간이 깎인다.
create or replace function revoke_paid_membership(
  p_order_id text,
  p_expires_at timestamptz
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment payments%rowtype;
begin
  select * into v_payment from payments where order_id = p_order_id for update;

  if not found then return 'not_found'; end if;
  if v_payment.status = 'canceled' then return 'already'; end if;
  if v_payment.status <> 'paid' then return 'not_paid'; end if;

  if v_payment.granted_at is not null then
    update memberships
       set expires_at = p_expires_at,
           -- 되돌린 만료가 이미 지났으면 그 자리에서 무료로 떨어뜨린다. tier 를
           -- 'premium' 인 채 두면 만료 판정이 expires_at 을 보긴 하지만, 화면마다
           -- tier 만 보는 코드가 하나라도 생기면 환불한 계정이 계속 열린다.
           tier = case when p_expires_at > now() then 'premium' else 'free' end,
           updated_at = now()
     where user_id = v_payment.user_id;
  end if;

  update payments
     set status = 'canceled', canceled_at = now(), updated_at = now()
   where order_id = p_order_id;
  return 'applied';
end $$;

-- ⚠ 이 두 함수는 security definer 라 RLS 를 우회한다. 로그인한 사용자가 직접 부를 수
-- 있으면 자기 주문번호와 원하는 만료일(2099년)을 넘겨 스스로 프리미엄이 된다.
-- 그래서 실행 권한을 전부 회수하고 service_role 에만 다시 준다 — 서버 코드만 부를 수
-- 있게 하려는 것이다. (Postgres 는 새 함수의 EXECUTE 를 PUBLIC 에 기본 부여한다.)
revoke all on function apply_paid_membership(text, timestamptz) from public, anon, authenticated;
revoke all on function revoke_paid_membership(text, timestamptz) from public, anon, authenticated;
grant execute on function apply_paid_membership(text, timestamptz) to service_role;
grant execute on function revoke_paid_membership(text, timestamptz) to service_role;
