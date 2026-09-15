# Edge Function 용 core 번들 (`_shared/core.mjs`)

관련 코드: `packages/core/src/server.ts`(서버 진입점) · `packages/core/src/rules/*`(규칙) ·
`packages/core/src/data/*`(DI 데이터 접근) · `packages/core/scripts/bundle-edge.mjs`(번들러) ·
`supabase/functions/_shared/core.mjs`(**생성물**) · `supabase/functions/_shared/http.ts`
설계 배경: `apps/mobile/docs/redesign-architecture.md` §3.2·§3.4·§6.6·§6.8.

## 왜 번들인가 — Deno 는 워크스페이스 패키지를 못 읽는다

Edge Function 은 Deno 로 돈다. `@gongmoa/core` 는 npm 워크스페이스의 TS 소스 패키지라
`node_modules` 링크·`package.json` `exports` 로 해석되는데, Supabase Edge 런타임(배포본·
`functions serve` 모두)은 함수 디렉터리 밖의 워크스페이스를 보지 않고 import map 도 없다.
`import "@gongmoa/core"` 는 배포 시점에 그냥 깨진다.

그래서 **웹은 소스를 직접 import 하고, Edge 는 그 소스를 esbuild 로 묶은 단일 ESM 파일을
import 한다.** 원본은 하나(`packages/core/src`), Edge 쪽 파일은 생성물이다. 이전에는
`_shared/srs.ts`·`review-pick.ts`·`profanity.ts`·`status.ts` 처럼 규칙을 손으로 복사해 두고
"두 파일을 함께 고칠 것"이라는 금지선으로 버텼다 — 한쪽만 고쳐 웹과 앱의 복습일이 어긋나는
사고를 사람이 막던 구조다. 번들은 그 규칙을 기계가 지키게 한 것이다.

## 만드는 법·검사하는 법

```
npm run bundle-edge -w @gongmoa/core            # src/server.ts + src/index.ts → supabase/functions/_shared/core.mjs
npm run bundle-edge -w @gongmoa/core -- --watch # 로컬 개발 중 (docs/dev-workflow.md)
npm run bundle-edge:check -w @gongmoa/core      # 재생성해 커밋본과 diff 0 인지 — CI 게이트
```

- esbuild `format: esm`, `platform: neutral`, `bundle: true`, `external: ['@supabase/supabase-js']`.
- `--check` 는 diff 0 외에도 출력에 `esm.sh`·`node_modules` 문자열이 없는지, `import` 구문이
  **0개**인지 본다. Edge 는 `https://esm.sh/@supabase/supabase-js@2` 를 따로 읽으므로 번들
  안에 supabase-js 가 값으로 들어오면 이중 로드가 된다 — core 에서 `@supabase/supabase-js` 는
  `import type` 만 허용(ESLint 규칙)하는 이유.
- `.d.ts` 도 같이 생성돼 Deno 쪽에서 `satisfies` 로 계약 타입을 검사한다.
- **`core.mjs` 는 커밋한다.** 손으로 고치지 말 것 — 다음 `bundle-edge` 가 덮어쓰고, 그 전에
  `bundle-edge:check` 가 PR 을 막는다. 규칙을 바꾸려면 `packages/core/src` 를 고치고 번들을
  다시 만들어 **같은 커밋**에 넣는다(`.github/workflows/mobile-ci.yml`).

## 배치 규칙 — 규칙은 core 한 곳, 서버 액션과 Edge 는 어댑터

- **규칙 본문은 `packages/core/src/rules/*` 에만 둔다.** service_role 클라이언트를 주입받아
  순수 규칙 + 주입된 클라이언트 호출만 한다. `server-only`·`'use cache'`·`revalidatePath`·
  `createAdminClient()`·`Deno.serve`·`corsHeaders` 같은 런타임 의존은 규칙에 넣지 않는다.
- **웹 서버 액션(`apps/web/src/app/**/actions.ts`)과 Edge Function(`supabase/functions/*`)은
  얇은 어댑터다.** 인증 확인 → 입력 파싱 → `rules/*` 호출 → 응답 직렬화(+웹은 `revalidatePath`)
  까지만. 어댑터에 `if` 가 늘어나기 시작하면 규칙이 새는 것이다.
- `@gongmoa/core/server` 는 `apps/web` 과 `supabase/functions` 만 import 한다. `apps/mobile` 은
  ESLint `no-restricted-imports` 로 막는다(service_role 규칙이 앱 번들에 섞이는 일이 구조적으로
  불가능해야 한다).
- 결정성이 필요한 규칙(`recordQuestionResults` 의 `fuzz`, `now`)은 주입 가능하게 만들고 기본값만
  `Math.random`/`new Date()` 로 둔다 — `docs/agents/contract-tests.md`.

## 규칙 하나를 새로 넣는 순서

1. `packages/core/src/rules/<name>.ts` 에 규칙을 쓴다. 시그니처는 `(client, input, deps?)`.
   `deps` 에 `now`·`fuzz` 같은 비결정 요소를 둔다. `rules/<name>.test.ts` 로 순수 부분을 고정.
2. `packages/core/src/server.ts` 에서 export 한다.
3. 웹 어댑터: 서버 액션에서 `createAdminClient()` 로 만든 클라이언트를 넘겨 호출. 웹 전용
   후처리(`revalidatePath`)는 여기.
4. Edge 어댑터: `supabase/functions/<name>/index.ts` 에서 `_shared/http.ts` 의
   `corsHeaders`·`json`·`isUuid` + `_shared/clients.ts` 의 `requireUser`·`adminClient` 를 쓰고
   `../_shared/core.mjs` 에서 규칙을 import.
5. `npm run bundle-edge -w @gongmoa/core` → `core.mjs` 갱신본을 같은 커밋에.
6. 계약 테스트 케이스 추가(`docs/agents/contract-tests.md`), 파리티 매트릭스 행
   (`docs/agents/mobile-parity.md`).

## `_shared/` 의 규칙 사본은 전부 삭제됐다

`_shared/{status,status-targets,membership,attendance,explanations,media}.ts` 는 번들 도입과
함께, `_shared/cbt.ts` 는 `http.ts` 로 갈라진 뒤 삭제됐다. 마지막까지 re-export 로 남겨 뒀던
`srs.ts`·`review-pick.ts`·`profanity.ts` 도 2026-09-15 소유자 승인(설계서 §13 질문 9)으로
AGENTS.md 문구 수정과 같은 커밋에서 삭제했다. 지금 `_shared/` 에는 `clients.ts`·`http.ts` 와
생성물(`core.mjs`·`core.d.ts`·`core-types/`)만 있다.

- Edge Function 이 규칙을 쓰는 경로는 `../_shared/core.mjs` 하나뿐이다.
- `_shared/` 에 규칙 파일이나 re-export 파일을 다시 만들지 말 것 — 사본이 부활하는 첫걸음이다.

## 응답 계약 — Edge 응답은 "추가만"

앱은 스토어 심사·OTA 지연 때문에 서버보다 늦게 바뀐다. 오래된 앱이 오늘의 Edge 를 부른다.

- 응답 필드는 **추가만** 한다. 필드 삭제·이름 변경·타입/의미 변경 금지.
- 깨지는 변경이 필요하면 새 함수명(`cbt-submit-v2`)으로 만들고 옛 함수는 남긴다.
- 요청 필드는 optional 추가만. 새 필수 필드는 곧 깨지는 변경이다.
- 계약 타입은 `packages/core/src/edge/contracts.ts` 한 곳. 웹 어댑터의 반환 타입도 같은 타입을
  쓰게 해 두 어댑터가 갈라지지 않게 한다.

## 헤더 `x-gongmoa-app-build` / `x-gongmoa-platform`

앱은 supabase-js `createClient` 의 `global.headers` 로 두 헤더를 모든 요청에 고정한다
(`x-gongmoa-app-build`: `expo-application` 의 `nativeBuildVersion`, `x-gongmoa-platform`:
`ios`|`android`). 서버는 로그에 남기고, `x-gongmoa-app-build` 가 `/api/app/config` 의
`minBuild` 미만이면 `426 { error: "update-required" }` 로 거부한다(계약 변경 시 서버 쪽 안전망).

- `_shared/http.ts` 의 `corsHeaders` `Access-Control-Allow-Headers` 에 두 헤더가 들어 있다.
  빼지 말 것 — 네이티브에는 무관하지만 Expo web/dev 클라이언트의 preflight 가 막힌다.
- 웹은 이 헤더를 보내지 않는다. 헤더 없음 = 웹(또는 스크립트)으로 취급하고 거부하지 않는다.

## 금지선

- `supabase/functions/_shared/core.mjs` 를 손으로 고치지 말 것. `packages/core/src` 를 고치고
  `npm run bundle-edge -w @gongmoa/core` 로 재생성해 같은 커밋에 넣는다.
- 규칙을 어댑터(서버 액션·Edge)에 새로 쓰지 말 것. 두 어댑터 중 한쪽에만 있는 규칙은 웹과 앱이
  다른 결과를 내는 버그다.
- `packages/core` 에서 `@supabase/supabase-js` 를 값으로 import 하지 말 것(`import type` 만).
  번들에 들어가면 Edge 가 supabase-js 를 두 번 로드한다.
- `_shared/` 에 규칙 사본·re-export 파일을 다시 만들지 말 것(`srs.ts` 등은 2026-09-15 삭제됨).
- Edge 응답에서 필드를 빼거나 의미를 바꾸지 말 것. 새 함수명으로.
