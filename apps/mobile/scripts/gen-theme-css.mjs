// 앱 테마 CSS 생성기. `node scripts/gen-theme-css.mjs` → src/theme/theme.native.css.
//
// 왜 필요한가: 정본 theme.css 는 다크 값을 `[data-theme="dark"]`(웹 <html> 속성)와
// `@media (prefers-color-scheme)` 블록에 둔다. Uniwind 는 그 두 셀렉터를 읽지 않고
// `@layer theme { :root { @variant light/dark { … } } }` 형태만 테마 변수로 인식한다.
// 그래서 같은 값을 그 형태로 다시 적되, 손으로 적지 않고 tokens.json 에서 뽑는다 —
// 값이 두 벌이 되면 웹과 앱 색이 갈라진다. `--check` 는 커밋된 생성물이 정본과 같은지
// 검사한다(typecheck 스크립트에 물려 CI 게이트).
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const tokens = require("@gongmoa/design-tokens/tokens.json");
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "theme", "theme.native.css");

function block(theme) {
  const t = tokens[theme];
  const lines = [
    `      --background: ${t.background};`,
    `      --foreground: ${t.foreground};`,
    ...Object.entries(t.blue).map(([k, v]) => `      --color-blue-${k}: ${v};`),
  ];
  return [`    @variant ${theme} {`, ...lines, `    }`].join("\n");
}

const css = [
  "/* 생성 파일 — 직접 고치지 말 것. 정본은 packages/design-tokens/theme.css,",
  "   갱신은 `node scripts/gen-theme-css.mjs`. Uniwind 가 읽는 라이트/다크 테마 변수. */",
  "@layer theme {",
  "  :root {",
  block("light"),
  block("dark"),
  "  }",
  "}",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(OUT, "utf8");
  } catch {
    // 없음 → 불일치
  }
  if (current !== css) {
    console.error("[gen-theme-css] src/theme/theme.native.css 가 정본과 다르다. `node scripts/gen-theme-css.mjs` 를 실행할 것.");
    process.exit(1);
  }
  console.log("[gen-theme-css] 최신.");
} else {
  writeFileSync(OUT, css);
  console.log("wrote", OUT);
}
