// 웹 globals.css 를 실제 Tailwind v4 PostCSS 플러그인으로 컴파일해서, 정본을 @import 로
// 끌어온 뒤에도 테마 토큰이 결과 CSS 에 그대로 들어가는지 확인한다(웹 픽셀 불변 게이트).
//   node scripts/check-web-css.mjs
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { PKG_DIR } from "./gen.mjs";
import { parseTheme } from "./parse-theme.mjs";

const WEB_DIR = resolve(PKG_DIR, "../../apps/web");
const GLOBALS = resolve(WEB_DIR, "src/app/globals.css");
const require = createRequire(resolve(WEB_DIR, "package.json"));
const postcss = require("postcss");
const tailwind = require("@tailwindcss/postcss");

const { light, dark } = parseTheme(readFileSync(resolve(PKG_DIR, "theme.css"), "utf8"));
const result = await postcss([tailwind({ base: WEB_DIR })]).process(readFileSync(GLOBALS, "utf8"), {
  from: GLOBALS,
});
const css = result.css;

const failures = [];
const expect = (needle, label) => {
  if (!css.includes(needle)) failures.push(`${label}: '${needle}' 가 컴파일 결과에 없음`);
};

// @theme 이 Tailwind 에 먹혔는지: --color-blue-* 가 :root 변수로 등록되고 유틸리티가 그 변수를 참조한다.
for (const [shade, hex] of Object.entries(light.blue)) expect(`--color-blue-${shade}: ${hex}`, "@theme light");
expect(`--color-blue-600: ${light.blue["600"]}`, "@theme");
expect(`--background: ${light.background}`, ":root light");
expect(`--foreground: ${light.foreground}`, ":root light");
expect("color-scheme: light", ":root light");
// @theme inline 은 변수를 :root 로 내보내지 않고 유틸리티에 값을 인라인한다 — at-rule 이 소비됐는지만 본다.
if (/@theme\b/.test(css)) failures.push("@theme 이 처리되지 않고 남음(Tailwind 가 @import 된 정본을 못 읽음)");
// 다크 오버라이드 두 곳
expect(`--background: ${dark.background}`, "dark");
expect(`--color-blue-600: ${dark.blue["600"]}`, "dark blue-600");
expect(`--color-blue-400: ${dark.blue["400"]}`, "dark blue-400");
expect('[data-theme="dark"]', "dark selector");
expect(":root:not([data-theme])", "system dark selector");
expect("prefers-color-scheme: dark", "system dark media");
// 웹 전용 규칙은 그대로 남아 있어야 한다.
if (css.includes("@custom-variant")) failures.push("@custom-variant 가 처리되지 않고 남음");
if (css.includes('@import "@gongmoa/design-tokens')) failures.push("design-tokens @import 가 인라인되지 않음");

// 반드시 유틸리티 하나는 재정의 변수를 써야 "이름은 blue, 픽셀은 초록" 계약이 살아 있다.
if (!/\.bg-blue-600\s*\{[^}]*var\(--color-blue-600\)/.test(css)) {
  failures.push(".bg-blue-600 유틸리티가 var(--color-blue-600) 을 참조하지 않음(소스 스캔 실패?)");
}

if (failures.length) {
  for (const f of failures) console.error("FAIL", f);
  process.exit(1);
}
console.log(`design-tokens: apps/web globals.css 컴파일 OK (${(css.length / 1024).toFixed(0)}KB), 토큰 ${Object.keys(light.blue).length + 3}개 확인`);
