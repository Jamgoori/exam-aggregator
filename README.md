# 공무원 기출문제 아그리게이터

Next.js + Supabase 기반. 관리자가 연도/시험/과목 라벨을 붙여 PDF를 업로드하면 공개 페이지에서 과목별로 자동 노출된다.

## 1. Supabase 프로젝트 준비

1. https://supabase.com 에서 계정 생성 후 새 프로젝트 생성 (리전은 Seoul 권장)
2. 프로젝트 대시보드 > SQL Editor > New query 에서 [`supabase/schema.sql`](supabase/schema.sql) 내용을 붙여넣고 실행
   - `subjects`, `exam_types`, `exam_papers` 테이블과 RLS 정책, 초기 과목/시험종류 데이터가 생성됨
3. Storage > New bucket 에서 이름 `exam-papers`로 **Public bucket**으로 생성
   - 개인정보가 없는 공개 기출문제 PDF이므로 public으로 두고 URL로 바로 서빙
4. Authentication > Users > Add user 에서 관리자 계정(본인 이메일/비밀번호) 1개 생성
   - 이 계정으로 `/admin/login`에 로그인해야 업로드 가능
5. Authentication > Providers > Email > **Confirm email을 반드시 끈다**
   - 일반 회원가입(`/signup`)은 이메일이 아니라 아이디로 가입하는데, Supabase Auth가 이메일
     형식만 지원해서 내부적으로 `아이디@users.invalid` 같은 실존하지 않는 주소로 저장한다.
     이 주소는 실제로 메일을 받을 수 없으므로, Confirm email이 켜져 있으면 가입 후 아무도
     로그인할 수 없다.

## 2. 환경변수

`.env.local.example`을 복사해 `.env.local` 생성 후, Supabase 프로젝트 Settings > API 에서 값을 채운다.

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Publishable key (anon key의 최신 명칭)
- `SUPABASE_SERVICE_ROLE_KEY`: service_role secret key (벌크 업로드 스크립트 전용, 절대 공개 금지)

## 3. 로컬 실행

```bash
npm install
npm run dev
```

- http://localhost:3000 : 과목 목록 (공개)
- http://localhost:3000/subjects/korean 등 : 과목별 기출문제 목록 (공개)
- http://localhost:3000/admin/login : 관리자 로그인
- http://localhost:3000/admin/upload : PDF 업로드 (로그인 필요)

## 4. 벌크 업로드 (폴더에 PDF 넣고 한 번에 올리기)

관리자 페이지에서 한 건씩 올리는 대신, 같은 연도·시험의 PDF를 폴더 하나에 몰아넣고
스크립트로 한 번에 올릴 수 있다. 파일명은 과목명 그대로면 된다 (`국어.pdf`, `영어.pdf` ...).

```
uploads/incoming/
  국어.pdf
  영어.pdf
  한국사.pdf
```

```bash
npm run bulk-upload -- --year 2025 --type 지방직 --level 9급
```

- `--type`은 `exam_types.name`(국가직/지방직/서울시/법원직/경찰직)과 정확히 일치해야 함
- `--level`(급수), `--round`(회차, 기본 1)는 선택
- 파일명이 `subjects.name`과 다르면 스크립트 안 `SUBJECT_ALIASES`에 별칭을 추가
- 업로드 성공한 파일은 `uploads/incoming/_done/{year}-{type}(-{level})/`로 자동 이동
- 매칭 실패한 파일은 건너뛰고 마지막에 목록으로 알려줌

## 구조

- `supabase/schema.sql` : DB 스키마 + RLS 정책 (Supabase SQL Editor에서 1회 실행, 재실행해도 안전)
- `scripts/bulk-upload.mjs` : 폴더 단위 벌크 업로드 스크립트 (service_role key 사용)
- `src/lib/supabase/` : 브라우저/서버용 Supabase 클라이언트, 타입
- `src/proxy.ts` : Supabase 세션 쿠키 갱신 (Next.js 16부터 middleware.ts가 proxy.ts로 개명됨)
- `src/app/admin/` : 로그인, 업로드 폼, 서버 액션
- `src/app/page.tsx` : 자료실 홈 (검색/카테고리 필터/정렬/카드 그리드)
- `src/app/subjects/`, `src/app/subjects/[slug]/` : 과목별 목록/공개 페이지
- `src/app/download/[id]/` : 다운로드 수 집계 후 PDF로 리다이렉트

## 다음 단계 (추후 기능)

현재 MVP는 "PDF 통째 업로드 + 과목별 분류"까지만 지원한다. 아래 기능들은 PDF 안의
개별 문제를 구조화된 데이터(문제/보기/정답/단원)로 분리해 저장해야 구현 가능하므로,
`exam_papers`를 FK로 참조하는 `questions` 테이블(문제번호/지문/보기/정답/단원태그) 추가가
선행되어야 한다. 기존 `exam_papers` 구조를 갈아엎을 필요는 없고 순수 추가로 확장 가능하다.
`questions`를 채우는 방법(수작업 입력 vs PDF 파싱+AI 추출)은 별도로 검토 필요.

- AI 기반 해설 제공
- 틀린 단원 정리 (오답노트)
- 회독별 점수 추이
- 기출문제 섞기
- 시험지별 첫 시험 기준 점수 평균
