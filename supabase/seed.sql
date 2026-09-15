-- 로컬 개발 픽스처. `supabase db reset`(과 첫 `supabase start`)이 실행한다.
--
-- 스키마는 어떻게 들어오나:
--   psql 의 `\i schema.sql` 은 CLI 의 seed 실행기(psql 이 아니라 pgx)에서 동작하지 않는다.
--   대신 supabase/config.toml 의 `[db.seed] sql_paths = ["./schema.sql", "./seed.sql"]` 가
--   schema.sql 을 **이 파일보다 먼저** 실행한다. schema.sql 은 IF NOT EXISTS / ON CONFLICT 로
--   멱등이라 seed 경로로 적용해도 안전하다. 그래서 이 파일은 스키마를 전제로 픽스처만 넣는다.
--   (대안으로 검토한 `[db.migrations] schema_paths` 는 선언적 스키마 diff 입력일 뿐 reset 이
--   적용하지 않고, migrations/ 에 복사본을 두면 schema.sql 과 두 벌이 된다 — 채택하지 않음.)
--
-- 규칙:
--   * 이 파일은 로컬·CI 전용이다. 프로덕션에 돌리지 않는다.
--   * 로컬 전용 우회 SQL(정책 완화, 권한 부여)을 여기 넣지 말 것 — 로컬에서만 되는 기능이 생긴다.
--     schema.sql 이 로컬에서 실패하면 schema.sql 을 고친다.
--   * 모든 insert 는 `on conflict do nothing` + 고정 UUID. 계약 테스트 스냅샷이 id 를 본다.
--   * 정답(paper_answers)·해설은 계약 테스트 픽스처(packages/core/src/rules/__fixtures__/*.sql)가
--     케이스별로 넣는다. 여기에는 카탈로그 최소본만 둔다.

-- 과목·시험 유형 (slug·name 은 packages/core/src/subject-label.ts 의 정본 표기와 맞춘다)
insert into subjects (id, slug, name, display_order) values
  ('00000000-0000-4000-8000-000000000101', 'korean',         '국어',   1),
  ('00000000-0000-4000-8000-000000000102', 'english',        '영어',   2),
  ('00000000-0000-4000-8000-000000000103', 'korean-history', '한국사', 3)
on conflict (slug) do nothing;

insert into exam_types (id, name, display_order) values
  ('00000000-0000-4000-8000-000000000201', '국가직', 1),
  ('00000000-0000-4000-8000-000000000202', '지방직', 2)
on conflict (name) do nothing;

-- 문제지 (file_path 는 로컬 Storage 에 실제 객체가 없어도 목록·상세·CBT 시작까지는 동작한다.
-- PDF 뷰어·문항 이미지를 보려면 Studio → Storage 의 exam-papers 버킷에 같은 경로로 올린다.)
insert into exam_papers (id, subject_id, exam_type_id, year, round, level, title, question_count, file_path, file_name) values
  ('00000000-0000-4000-8000-000000000301',
   '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000201',
   2025, 1, '9급', '2025 국가직 9급 국어', 20, 'fixtures/2025-national-9-korean.pdf', '2025_국가직_9급_국어.pdf'),
  ('00000000-0000-4000-8000-000000000302',
   '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000201',
   2025, 1, '9급', '2025 국가직 9급 영어', 20, 'fixtures/2025-national-9-english.pdf', '2025_국가직_9급_영어.pdf')
on conflict (id) do nothing;

-- TODO(픽스처): dedup 형제 문제지(같은 정답·문항 수 다른 경우), 정답지(answer_keys),
-- 문항 이미지(question_images) 행. 계약 테스트 케이스 #7·#14 가 요구하는 모양은
-- apps/web/docs/agents/contract-tests.md 표를 따른다.

-- 개발용 계정은 SQL 로 만들지 않는다(auth.users 직접 insert 는 CLI 버전마다 컬럼이 달라 깨진다).
-- 앱의 __DEV__ 이메일/비밀번호 폼으로 가입하거나 Studio(54323) → Authentication → Add user.
-- 관리자가 필요하면 가입 후 아래 한 줄을 이메일만 바꿔 실행:
--   insert into admins (email) values ('dev@example.com') on conflict do nothing;
