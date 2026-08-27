-- AI 약점 진단의 배치 생성 상태. Supabase SQL Editor 에서 1회 실행(재실행 안전).
--
-- 맞춤 극복법은 Message Batches API 로 만든다(주 1회짜리 기능이라 몇 분 늦어도 되고
-- 요금이 절반이다). 제출과 수거가 몇 시간 떨어져 있어서 그 사이를 이 테이블이 잇는다.
--
-- context 에 제출 시점의 무AI 리포트(요약·개념 목록·과목 추세)와 "그때 무엇을 물어봤는지"
-- (대상 개념 목록)를 통째로 넣어 둔다. 수거할 때 다시 집계하면 그 사이에 사용자가 푼
-- 문제까지 섞여 프롬프트와 결과가 어긋나기 때문이다.
create table if not exists ai_diagnosis_batches (
  id uuid primary key default gen_random_uuid(),
  diagnosis_id uuid not null references ai_diagnoses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Anthropic Message Batch id(msgbatch_...). 한 배치에 여러 사용자가 실린다.
  batch_id text not null,
  -- 배치 안에서 이 요청을 가리키는 키. 진단 행 id 를 그대로 쓴다.
  custom_id text not null,
  model text not null,
  context jsonb not null,
  -- pending(처리 중) | ready(리포트 저장 완료) | failed(만료·오류·생성 실패)
  status text not null default 'pending',
  error text,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (batch_id, custom_id)
);

-- 수거가 "처리 중인 것"만 훑는다.
create index if not exists ai_diagnosis_batches_pending_idx
  on ai_diagnosis_batches(status, requested_at);
-- 진단 페이지가 "내 극복법이 지금 만들어지는 중인가"를 묻는다.
create index if not exists ai_diagnosis_batches_user_idx
  on ai_diagnosis_batches(user_id, requested_at desc);
-- 제출이 "이 진단은 이미 배치에 실렸는가 / 몇 번 시도했는가"를 묻는다.
create index if not exists ai_diagnosis_batches_diagnosis_idx
  on ai_diagnosis_batches(diagnosis_id);

alter table ai_diagnosis_batches enable row level security;

-- 정책을 하나도 두지 않는다 = service_role 만 읽고 쓴다. 사용자가 직접 읽을 이유가 없고
-- (진단 결과는 ai_diagnoses 에서 본다), 쓸 수 있으면 요금이 나가는 배치를 마음대로
-- 만들거나 남의 요청을 닫아버릴 수 있다.
revoke all on ai_diagnosis_batches from anon, authenticated;
