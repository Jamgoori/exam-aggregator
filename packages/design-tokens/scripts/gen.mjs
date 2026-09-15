// theme.css(정본) → tokens.json + tokens.ts 생성기.
//   node scripts/gen.mjs          생성물 갱신
//   node scripts/gen.mjs --check  커밋된 생성물이 정본과 같은지 검사(CI 게이트, 다르면 exit 1)
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseTheme } from "./parse-theme.mjs";

export const PKG_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const THEME_CSS = resolve(PKG_DIR, "theme.css");
export const TOKENS_JSON = resolve(PKG_DIR, "tokens.json");
export const TOKENS_TS = resolve(PKG_DIR, "tokens.ts");

function toTsLiteral(value, indent = "") {
  if (typeof value === "string") return JSON.stringify(value);
  const inner = indent + "  ";
  const entries = Object.entries(value).map(
    ([k, v]) => `${inner}${/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k)}: ${toTsLiteral(v, inner)},`,
  );
  return `{\n${entries.join("\n")}\n${indent}}`;
}

/** 정본 CSS 문자열 → { json, ts } 생성물 문자열. */
export function generate(css) {
  const tokens = parseTheme(css);
  const json = JSON.stringify(tokens, null, 2) + "\n";
  const ts = `// 생성 파일 — 직접 고치지 말 것. 정본은 theme.css, 갱신은 \`npm run gen -w @gongmoa/design-tokens\`.
// 라이트/다크가 완전히 해석된 hex 값. CSS 변수를 못 읽는 소비자(RN Skia 캔버스·StatusBar·
// lucide color prop·AdMob 배경·adaptiveIcon.backgroundColor 등)용.

export const tokens = ${toTsLiteral(tokens)} as const;

export type Tokens = typeof tokens;
export type Theme = keyof Tokens;
export type ThemeTokens = Tokens[Theme];
export type BlueShade = keyof Tokens["light"]["blue"];

export const lightTokens = tokens.light;
export const darkTokens = tokens.dark;

export function themeTokens(theme: Theme): ThemeTokens {
  return tokens[theme];
}
`;
  return { json, ts };
}

function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function firstDiffLine(a, b) {
  const al = a.split("\n");
  const bl = b.split("\n");
  for (let i = 0; i < Math.max(al.length, bl.length); i++) {
    if (al[i] !== bl[i]) return { line: i + 1, expected: al[i] ?? "<없음>", actual: bl[i] ?? "<없음>" };
  }
  return null;
}

/** --check: 커밋된 생성물과 비교. 다르면 메시지 배열을 돌려준다(비어 있으면 통과). */
export function check() {
  const { json, ts } = generate(readFileSync(THEME_CSS, "utf8"));
  const problems = [];
  for (const [path, expected] of [
    [TOKENS_JSON, json],
    [TOKENS_TS, ts],
  ]) {
    const actual = readOrEmpty(path);
    if (actual !== expected) {
      const d = firstDiffLine(expected, actual);
      problems.push(
        `${path} 가 theme.css 와 다름 (line ${d?.line}: 기대 ${JSON.stringify(d?.expected)} / 실제 ${JSON.stringify(d?.actual)}). ` +
          "`npm run gen -w @gongmoa/design-tokens` 로 다시 생성해 커밋할 것.",
      );
    }
  }
  return problems;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  if (process.argv.includes("--check")) {
    const problems = check();
    if (problems.length) {
      for (const p of problems) console.error(p);
      process.exit(1);
    }
    console.log("design-tokens: 생성물이 theme.css 와 일치");
  } else {
    const { json, ts } = generate(readFileSync(THEME_CSS, "utf8"));
    writeFileSync(TOKENS_JSON, json);
    writeFileSync(TOKENS_TS, ts);
    console.log(`design-tokens: ${TOKENS_JSON}, ${TOKENS_TS} 생성`);
  }
}
