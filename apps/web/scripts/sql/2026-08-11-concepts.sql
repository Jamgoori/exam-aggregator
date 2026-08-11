-- 개념 사전 (2026-08-11)
--
-- question_explanations.keyword_title 은 해설 배치가 문항마다 자유롭게 쓴 문자열이라
-- "대칭키 암호" / "대칭키 암호화 방식" / "대칭키 알고리즘"이 다른 값으로 들어와 있다.
-- 지금은 packages/core/src/concept-key.ts 가 "제목의 첫 의미 토큰"으로 거칠게 묶어
-- 복습 큐 다양성에만 쓴다. 약점 진단("대칭키가 약합니다")은 그 정확도로 못 한다 —
-- 사용자에게 틀린 말을 하게 되므로 사람이 정리한 정본 목록이 있어야 한다.
--
-- 추가만 한다. keyword_title 은 화면에 그대로 보여주는 값이라 건드리지 않는다.
-- 정리 결과는 concept_id 라는 별도 축으로 붙인다.
--
-- 설계 결정 세 가지와 근거:
--
-- 1) 계층은 concepts.parent_id (단원 = parent_id 가 null 인 행).
--    questions.unit_tag 컬럼이 "오답노트 단원별 분석용"으로 예약돼 있지만 그쪽으로
--    가지 않는다. 단원을 텍스트로 questions 에 박으면 개념과 단원이 서로 다른
--    테이블에 살게 되고, 단원 이름을 고칠 때 문항 전체를 훑어야 한다. 축은 하나에
--    모아 둔다.
--
-- 2) 문항당 정본 개념은 하나(question_explanations.concept_id).
--    기출 문항은 보통 개념 하나를 묻고, 분포 계산이 단순해야 진단이 가벼워진다.
--    다개념이 필요해지면 question_concepts 매핑 테이블을 새로 만들어 확장한다
--    (그때 이 컬럼은 "주 개념"으로 남는다).
--
-- 3) 별칭은 별도 테이블(concept_aliases). text[] 로 두면 "같은 별칭이 두 개념에
--    붙는" 사고를 DB가 막아주지 못한다. 그건 진단이 조용히 틀리는 경로다.

create table if not exists concepts (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null references subjects(id) on delete cascade,
  -- 화면에 보여줄 정본 이름. 이름은 바꿔도 되지만 id 는 절대 재발급하지 않는다 —
  -- 진단은 시간에 따른 분포를 보여줄 것이라 id 가 바뀌면 이력이 끊긴다.
  name text not null,
  -- 단원(대분류). null 이면 이 행 자체가 단원이다.
  parent_id uuid references concepts(id) on delete set null,
  -- 개념을 없앨 때는 삭제가 아니라 합친다. 지우면 그 개념으로 쌓인 진단 이력이 함께
  -- 사라지고, 되돌릴 방법이 없다.
  merged_into uuid references concepts(id) on delete set null,
  created_at timestamptz not null default now()
);

-- 같은 과목 안에서 이름 중복 금지. 과목이 다르면 같은 이름이 있어도 된다
-- ("관계", "구조"처럼 과목마다 다른 개념을 가리키는 표기가 실제로 있다).
create unique index if not exists concepts_subject_name_uidx on concepts(subject_id, lower(name));
create index if not exists concepts_subject_idx on concepts(subject_id);
create index if not exists concepts_parent_idx on concepts(parent_id);

-- 별칭. 정본 이름 하나만 두면 다음 해설 배치분이 또 표류한다("대칭키 암호" 다음엔
-- "대칭키 암호화 방식"이 온다). normalized 는 앱에서 만든다
-- (packages/core normalizeConceptAlias — 공백·구두점 제거 + 소문자).
create table if not exists concept_aliases (
  concept_id uuid not null references concepts(id) on delete cascade,
  alias text not null,
  normalized text not null,
  created_at timestamptz not null default now(),
  primary key (concept_id, normalized)
);

-- 한 별칭이 두 개념에 붙지 못하게 한다.
--
-- ※ 이 전역 유일 제약은 2026-08-11-concept-aliases-subject.sql 에서 (subject_id,
--    normalized) 로 좁혀진다. 독해 기능형은 과목마다 같은 이름을 쓰는 게 정상이라
--    ("빈칸 추론"이 국어에도 영어에도 있다) 전역으로 막으면 안 된다. 그 파일을 함께
--    적용할 것.
create unique index if not exists concept_aliases_normalized_uidx on concept_aliases(normalized);

alter table question_explanations
  add column if not exists concept_id uuid references concepts(id) on delete set null;

create index if not exists question_explanations_concept_idx
  on question_explanations(concept_id);

alter table concepts enable row level security;
alter table concept_aliases enable row level security;

-- 읽기는 로그인 사용자에게 연다. 개념 이름은 해설 본문이 아니라 목차 수준의
-- 정보이고, 진단 화면이 "정보보호론 > 암호학 > 대칭키"를 그리려면 필요하다.
-- (해설 본문 question_explanations 는 지금처럼 admin 만 읽는다.)
drop policy if exists "read concepts" on concepts;
create policy "read concepts" on concepts for select to authenticated using (true);

drop policy if exists "read concept aliases" on concept_aliases;
create policy "read concept aliases" on concept_aliases for select to authenticated using (true);

-- 쓰기 정책 없음. 사전은 정리 스크립트(service_role)로만 바꾼다 — 사용자가 행을
-- 넣을 수 있으면 진단의 근거가 오염된다.

-- 적용 후 확인:
--
--   select count(*) from concepts;
--   select count(*) from question_explanations where concept_id is not null;
--
-- 현황·검증은 스크립트로 본다:
--   npm run concept-inventory            (현황 + 초안)
--   npm run concept-inventory -- --verify (매핑 후 건강 검진)
