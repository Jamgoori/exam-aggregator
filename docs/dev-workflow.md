# 로컬 개발 워크플로 (웹 + 로컬 Supabase + 앱)

설계 배경: `apps/mobile/docs/redesign-architecture.md` §11 "로컬 개발 워크플로"·"CI".
규칙 문서: `apps/web/AGENTS.md`, `apps/mobile/AGENTS.md`,
`apps/web/docs/agents/{edge-core-bundle,contract-tests,mobile-parity}.md`.

## 선행 조건

- Node 22, npm workspaces(루트 `npm install`).
- Docker(로컬 Supabase). Supabase CLI: `npm i -g supabase` 또는 `npx supabase`.
- 앱: Android Studio 에뮬레이터 또는 Xcode 시뮬레이터, 실기기는 같은 LAN. 네이티브 SDK
  (카카오·구글 로그인·pdf·Skia)라 **Expo Go 불가, dev client 필수**.
- `supabase/.env.local` — `supabase/.env.local.example` 을 복사해 값을 채운다(gitignore 대상).

## 터미널 3개

| 터미널 | 명령 | 포트 |
|---|---|---|
| 1. 웹 | `npm run web` | 3000 |
| 2. 로컬 Supabase + Edge | `supabase start && supabase functions serve --env-file supabase/.env.local` | API 54321 · DB 54322 · Studio 54323 |
| 3. 앱 | `cd apps/mobile && npx expo run:android` (또는 `run:ios`) | Metro 8081 |

- 터미널 2 의 `supabase start` 는 첫 실행에 `supabase/config.toml` 을 읽어 컨테이너를 띄우고
  `[db.seed] sql_paths` 순서(`schema.sql` → `seed.sql`)로 스키마·픽스처를 적재한다. 스키마를
  다시 올리려면 `supabase db reset`.
- Edge Function 은 `https://esm.sh/@supabase/supabase-js@2` 를 직접 import 하고 import map 이
  없다. `_shared/core.mjs` 는 생성물이라 core 를 고치는 동안에는 **네 번째 터미널**에서
  `npm run bundle-edge -w @gongmoa/core -- --watch` 를 켜 둔다(`functions serve` 가 파일 변경을
  다시 읽는다).
- `supabase functions serve` 는 `SUPABASE_URL`·`SUPABASE_ANON_KEY`·`SUPABASE_SERVICE_ROLE_KEY` 를
  자동 주입한다. `--env-file` 에는 그 외(`ANTHROPIC_API_KEY` 등)만 둔다.
- 키 값 확인: `supabase status -o env`.

## 앱 `.env` 값 (`apps/mobile/.env`)

`EXPO_PUBLIC_SUPABASE_URL` 은 앱이 도는 곳에서 **호스트의 54321** 을 가리켜야 한다.

| 실행 환경 | `EXPO_PUBLIC_SUPABASE_URL` |
|---|---|
| Android 에뮬레이터 | `http://10.0.2.2:54321` |
| iOS 시뮬레이터 | `http://127.0.0.1:54321` |
| 실기기(같은 LAN) | `http://<supabase start 를 띄운 PC 의 LAN IP>:54321` |

- `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = `supabase status` 의 anon key(로컬 고정값).
- `EXPO_PUBLIC_WEB_URL` = `http://<같은 호스트>:3000`(약관·`/api/app/config`).
- 실기기에서 Edge Function 까지 부르려면 `functions serve` 도 같은 호스트에서 돌고 있어야
  하고(54321 의 `/functions/v1/*` 로 프록시됨), 방화벽에서 54321·3000·8081 을 연다.
- 웹 `apps/web/.env.local` 도 같은 로컬 값(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`,
  service_role 은 `supabase status` 값)으로 바꾼다. 프로덕션 값을 그대로 두면 웹은 프로덕션에,
  앱은 로컬에 붙어 "웹에서 푼 응시가 앱에 안 보인다"가 된다.

## 로컬 로그인 — 개발용 이메일/비밀번호

로컬 Supabase 에는 Google·Kakao·Apple provider 가 없다(콘솔 키가 로컬에 없고 네이티브 SDK 는
프로덕션 프로젝트로 콜백한다). 그래서 `supabase/config.toml` 의 `[auth.email]` 에서
`enable_signup = true`, `enable_confirmations = false` 로 **로컬에서만** 이메일/비밀번호 가입을
켜 둔다.

- 앱 `login.tsx` 는 `__DEV__` 에서만 이메일/비밀번호 폼을 그린다. 프로덕션 번들에는 없다.
- 웹은 `/login` 에 폼이 없으므로 Studio(54323) → Authentication 에서 사용자를 만들거나 앱에서
  가입한 계정을 쓴다. 닉네임 트리거(`profiles` 동기화)는 로컬에서도 돈다.
- 프로덕션 Supabase 대시보드의 Email provider 는 켜지 않는다. 이 설정은 `config.toml`(로컬)
  에만 있다.

## 생성물 신선도 검사

커밋한 생성물이 원본과 어긋나면 PR 이 막힌다. 원본을 고쳤으면 생성물을 같은 커밋에 넣는다.

| 원본 | 생성물 | 재생성 | 검사 |
|---|---|---|---|
| `packages/core/src/**` | `supabase/functions/_shared/core.mjs` | `npm run bundle-edge -w @gongmoa/core` | `npm run bundle-edge:check -w @gongmoa/core` |
| `packages/design-tokens/theme.css` | `packages/design-tokens/tokens.{json,ts}` | `npm run gen -w @gongmoa/design-tokens` | `npm run check -w @gongmoa/design-tokens` |

## PR 게이트 (`.github/workflows/mobile-ci.yml` 이 같은 순서로 돈다)

```
npm ci
npm run typecheck                              # turbo: web·mobile·core·design-tokens
npm run lint --workspace @gongmoa/web
npm run test                                   # turbo: core 단위 테스트·design-tokens drift 등
npm run bundle-edge:check -w @gongmoa/core
npm run check -w @gongmoa/design-tokens
```

계약 테스트(`npm run test:contract -w @gongmoa/core`)는 Docker 가 필요해
`.github/workflows/contract-tests.yml` 에서만 돈다 — `supabase/**`·`packages/core/**` 를 건드린
PR 과 수동 실행(`apps/web/docs/agents/contract-tests.md`).

## 자주 막히는 곳

- `supabase start` 가 포트 충돌로 실패: 다른 프로젝트의 로컬 Supabase 가 떠 있다.
  `supabase stop --project-id <그쪽 이름>` 또는 `config.toml` 포트 변경.
- 앱이 `Network request failed`: `.env` 의 URL 이 `localhost` 다(에뮬레이터 안의 localhost 는
  에뮬레이터 자신). 위 표의 값으로.
- Edge 가 옛 규칙으로 동작: `core.mjs` 재생성을 안 했다. `--watch` 를 켜거나 `bundle-edge` 를
  한 번 돌린다.
- `db reset` 이 `schema.sql` 중간에서 실패: 파일은 멱등이지만 `auth.users` 트리거 같은 절은
  `postgres` 역할 권한이 필요하다 — 로컬 CLI 는 그 역할로 실행하므로 보통 문제없고, 실패 줄이
  프로덕션 전용 절이면 `seed.sql` 머리 주석의 안내대로 `schema.sql` 을 고친다(로컬 전용 우회
  SQL 을 `seed.sql` 에 넣지 말 것).
