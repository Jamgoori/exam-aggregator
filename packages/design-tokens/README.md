# @gongmoa/design-tokens

웹(Tailwind v4)과 앱(Uniwind)이 **같은 테마 토큰**을 쓰게 하는 패키지.
설계 배경은 `apps/mobile/docs/redesign-architecture.md` §3.3·§4.1.

## 정본은 `theme.css` 하나

`theme.css` 가 유일한 원본이다. 다섯 블록을 담는다(원래 `apps/web/src/app/globals.css` 에 있던 것을 그대로 옮김):

| 블록 | 내용 |
|---|---|
| `:root { … }` | 라이트 `--background` / `--foreground` / `color-scheme: light` |
| `@theme inline { … }` | `--color-background` / `--color-foreground` → 위 변수 매핑(Tailwind 유틸리티 `bg-background` 등) |
| `@theme { … }` | `--color-blue-50…950` 을 초록으로 리맵. **클래스 이름은 blue, 픽셀은 초록** — 수백 곳의 `bg-blue-600` 을 안 바꾸고 색만 바꾸는 규약이다. 앱도 `className="bg-blue-600"` 그대로 쓰고 emerald 로 고치지 않는다 |
| `[data-theme="dark"] { … }` | 사용자가 고른 다크 토글의 오버라이드(배경·전경·blue-400/500/600/700) |
| `@media (prefers-color-scheme: dark) { :root:not([data-theme]) {…} }` | JS 실행 전 시스템 다크 기본값. 선언은 위 다크 블록과 **항상 같아야** 한다(생성기가 다르면 실패시킴) |

## 소비자

- **웹** — `apps/web/src/app/globals.css` 가 `@import "tailwindcss"` · `@custom-variant dark` 다음에
  `@import "@gongmoa/design-tokens/theme.css";` 한 줄로 가져온다. `@tailwindcss/postcss` 가 node_modules 경로의
  `@import` 를 인라인하고 `@theme` 을 처리하므로 웹 픽셀은 옮기기 전과 같다. `apps/web/package.json` 의
  `dependencies["@gongmoa/design-tokens"]` 가 워크스페이스 링크를 만든다.
- **앱** — `apps/mobile` 의 `global.css`(신설 예정)가 `@import "tailwindcss"` + 같은 `theme.css` 를 Uniwind 로 읽는다.
  같은 파일이므로 웹의 `bg-blue-600` 과 앱의 `bg-blue-600` 은 둘 다 `#0a7d5b` 를 그린다.
- **값이 필요한 곳**(RN Skia 캔버스·StatusBar·lucide `color` prop·AdMob 배경·`adaptiveIcon.backgroundColor`) —
  `import { lightTokens, darkTokens, tokens } from "@gongmoa/design-tokens"` (`tokens.ts`) 또는 `tokens.json`.
  다크는 라이트 위에 오버라이드를 덮어 **완전히 해석된 hex** 다(`dark.blue["50"]` 도 값이 있다).

## `tokens.ts` / `tokens.json` 은 생성물

`scripts/gen.mjs` 가 `theme.css` 를 파싱해 만든다(행 번호가 아니라 셀렉터 + 중괄호 짝으로 블록을 찾으므로 주석·순서 변경에 안전).
**손으로 고치지 말 것.** `npm run check -w @gongmoa/design-tokens` (`gen --check`) 가 커밋된 생성물이 정본과 다르면 exit 1 —
CI 게이트로 쓴다. 같은 검사가 `npm test` 의 drift 테스트에도 들어 있다.

## 바꿀 때 절차

1. `packages/design-tokens/theme.css` 의 값을 고친다. 다크 값을 바꾸면 `[data-theme="dark"]` 와
   `@media (prefers-color-scheme: dark)` 안쪽 **두 곳을 같이** 고친다.
2. `npm run gen -w @gongmoa/design-tokens` → `tokens.json`·`tokens.ts` 갱신.
3. `npm run test -w @gongmoa/design-tokens` (drift·파서·생성물 일치) 와
   `npm run check-web-css -w @gongmoa/design-tokens` (웹 globals.css 를 실제 Tailwind 로 컴파일해 토큰이 들어갔는지 확인).
4. `theme.css` + 생성물 두 파일을 함께 커밋한다.

`globals.css` 에 `:root`·`@theme`·`[data-theme="dark"]` 블록을 다시 넣지 말 것 — drift 테스트가 실패하고, 웹과 앱의 색이 갈라진다.

## 스크립트

| 명령 | 역할 |
|---|---|
| `npm run gen` | 정본 → `tokens.json`, `tokens.ts` |
| `npm run check` | 생성물 신선도 검사(CI) |
| `npm run test` | drift·파서·생성물 테스트 (`node --test`) |
| `npm run check-web-css` | `apps/web` globals.css 를 `@tailwindcss/postcss` 로 컴파일해 토큰 포함 여부 확인 |
| `npm run typecheck` | `tokens.ts` 타입 검사 |
