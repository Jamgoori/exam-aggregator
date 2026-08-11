-- 별칭 유일 제약을 과목 안으로 좁힌다 (2026-08-11, 2026-08-11-concepts.sql 수정)
--
-- 처음에는 concept_aliases.normalized 를 전역 유일로 걸었다. "한 별칭이 두 개념에
-- 붙는" 사고를 DB가 막게 하려던 것인데, 과목 경계를 못 본 판단이었다.
--
-- 독해 기능형 개념은 과목마다 같은 이름을 쓴다. 정본 목록 뼈대를 검증하자마자
-- 다섯 건이 걸렸다:
--
--   빈칸 추론  — 국어 "추론" / 영어 "빈칸추론"
--   내용 일치  — 국어 "세부 내용 일치" / 영어 "내용 일치"
--   순서 배열  — 국어 "글의 순서와 삽입" / 영어 "순서 배열"
--   문장 삽입  — 국어 "글의 순서와 삽입" / 영어 "문장 삽입"
--
-- 이건 이름을 잘못 지은 게 아니라 실제로 두 과목에 같은 유형이 있는 것이다. 별칭에
-- 과목 접두를 붙여 피하면("영어 빈칸추론") 이름 규칙과 충돌하고 화면에도 지저분하게
-- 샌다. 제약을 과목 안으로 좁히는 게 맞다.
--
-- 개념이 과목에 속하므로 별칭도 과목에 속한다. 그 정합은 복합 외래키로 강제한다 —
-- 별칭의 subject_id 가 개념의 subject_id 와 다를 수 없다.
--
-- 추가·교체만 한다. 기존 행은 개념에서 subject_id 를 채워 넣는다.

alter table concept_aliases
  add column if not exists subject_id uuid references subjects(id) on delete cascade;

update concept_aliases a
  set subject_id = c.subject_id
  from concepts c
  where a.concept_id = c.id and a.subject_id is null;

alter table concept_aliases alter column subject_id set not null;

-- 개념과 별칭의 과목이 어긋나지 못하게 한다. 복합 외래키를 걸려면 참조 대상에
-- 같은 조합의 유일 인덱스가 있어야 한다.
create unique index if not exists concepts_id_subject_uidx on concepts(id, subject_id);

alter table concept_aliases
  drop constraint if exists concept_aliases_concept_subject_fkey;
alter table concept_aliases
  add constraint concept_aliases_concept_subject_fkey
  foreign key (concept_id, subject_id) references concepts(id, subject_id) on delete cascade;

-- 전역 유일 → 과목 안에서 유일.
drop index if exists concept_aliases_normalized_uidx;
create unique index if not exists concept_aliases_subject_normalized_uidx
  on concept_aliases(subject_id, normalized);

-- 적용 후 확인:
--   select subject_id, normalized, count(*) from concept_aliases
--   group by 1, 2 having count(*) > 1;   -- 비어 있어야 한다
