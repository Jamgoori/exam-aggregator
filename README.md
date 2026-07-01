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

## 2. 환경변수

`.env.local.example`을 복사해 `.env.local` 생성 후, Supabase 프로젝트 Settings > API 에서 값을 채운다.

```bash
cp .env.local.example .env.local
```

- `NEXT_PUBLIC_SUPABASE_URL`: Project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: anon public key

## 3. 로컬 실행

```bash
npm install
npm run dev
```

- http://localhost:3000 : 과목 목록 (공개)
- http://localhost:3000/subjects/korean 등 : 과목별 기출문제 목록 (공개)
- http://localhost:3000/admin/login : 관리자 로그인
- http://localhost:3000/admin/upload : PDF 업로드 (로그인 필요)

## 구조

- `supabase/schema.sql` : DB 스키마 + RLS 정책 (Supabase SQL Editor에서 1회 실행)
- `src/lib/supabase/` : 브라우저/서버용 Supabase 클라이언트, 타입
- `src/proxy.ts` : Supabase 세션 쿠키 갱신 (Next.js 16부터 middleware.ts가 proxy.ts로 개명됨)
- `src/app/admin/` : 로그인, 업로드 폼, 서버 액션
- `src/app/subjects/[slug]/` : 과목별 공개 목록 페이지

## 다음 단계 (추후 기능)

현재 MVP는 "PDF 통째 업로드 + 과목별 분류"까지만 지원한다. 아래 기능들은 PDF 안의
개별 문제를 구조화된 데이터(문제/보기/정답/단원)로 분리해 저장해야 구현 가능하므로,
스키마 확장(예: `questions` 테이블)이 선행되어야 한다.

- AI 기반 해설 제공
- 틀린 단원 정리 (오답노트)
- 회독별 점수 추이
- 기출문제 섞기
- 시험지별 첫 시험 기준 점수 평균
