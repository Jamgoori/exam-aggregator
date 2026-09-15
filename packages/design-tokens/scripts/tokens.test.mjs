// node --test scripts/*.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { BLOCK_SIGNATURES, findBlocks, findNestedBlock, parseDeclarations, parseTheme } from "./parse-theme.mjs";
import { PKG_DIR, THEME_CSS, TOKENS_JSON, TOKENS_TS, generate } from "./gen.mjs";

const WEB_GLOBALS = resolve(PKG_DIR, "../../apps/web/src/app/globals.css");
const theme = readFileSync(THEME_CSS, "utf8");
const globals = readFileSync(WEB_GLOBALS, "utf8");

test("drift: 다섯 토큰 블록은 globals.css 에 남아 있지 않고 theme.css 에만 있다", () => {
  for (const sig of BLOCK_SIGNATURES) {
    assert.equal(findBlocks(globals, sig).length, 0, `globals.css 에 '${sig}' 블록이 아직 남아 있음 — 정본은 theme.css`);
    assert.equal(findBlocks(theme, sig).length, 1, `theme.css 에 '${sig}' 블록이 정확히 1개여야 함`);
  }
});

test("drift: globals.css 는 tailwind·custom-variant 다음에 정본을 @import 한다", () => {
  const lines = globals.split("\n");
  const tw = lines.findIndex((l) => l.trim() === '@import "tailwindcss";');
  const variant = lines.findIndex((l) => l.startsWith("@custom-variant dark"));
  const tokens = lines.findIndex((l) => l.trim() === '@import "@gongmoa/design-tokens/theme.css";');
  assert.ok(tw >= 0, '@import "tailwindcss" 없음');
  assert.ok(variant > tw, "@custom-variant dark 없음(또는 tailwind import 앞)");
  assert.ok(tokens > variant, "design-tokens @import 가 없거나 @custom-variant 앞에 있음");
});

test("parse: 대표 값 (blue-600 light/dark, background light/dark)", () => {
  const { light, dark } = parseTheme(theme);
  assert.equal(light.blue["600"], "#0a7d5b");
  assert.equal(dark.blue["600"], "#096b4e");
  assert.equal(light.background, "#ffffff");
  assert.equal(dark.background, "#0a0a0a");
  assert.equal(light.foreground, "#171717");
  assert.equal(dark.foreground, "#ededed");
  assert.equal(light.colorScheme, "light");
  assert.equal(dark.colorScheme, "dark");
  // 다크가 덮어쓰지 않은 단계는 라이트 값을 그대로 물려받는다.
  assert.equal(dark.blue["50"], light.blue["50"]);
  assert.equal(dark.blue["950"], light.blue["950"]);
});

test("parse: @media 안의 시스템 다크 블록은 [data-theme=\"dark\"] 와 같은 선언을 가진다", () => {
  const dark = parseDeclarations(findBlocks(theme, '[data-theme="dark"] {')[0].body);
  const media = findBlocks(theme, "@media (prefers-color-scheme: dark) {")[0];
  const system = parseDeclarations(findNestedBlock(media.body, ":root:not([data-theme]) {").body);
  assert.deepEqual(system, dark);
});

test("gen: 커밋된 tokens.json / tokens.ts 는 theme.css 에서 생성한 것과 같다", () => {
  const { json, ts } = generate(theme);
  assert.equal(readFileSync(TOKENS_JSON, "utf8"), json, "tokens.json 이 오래됨 — npm run gen -w @gongmoa/design-tokens");
  assert.equal(readFileSync(TOKENS_TS, "utf8"), ts, "tokens.ts 가 오래됨 — npm run gen -w @gongmoa/design-tokens");
  assert.deepEqual(JSON.parse(json), parseTheme(theme));
});

test("parser: 주석 속 중괄호·중첩 셀렉터에 속지 않는다", () => {
  const css = `/* :root { --x: 1; } */\n.a { :root { --y: 2; } }\n:root {\n  --z: 3; /* } */\n}\n`;
  const blocks = findBlocks(css, ":root {");
  assert.equal(blocks.length, 1);
  assert.deepEqual(parseDeclarations(blocks[0].body), { "--z": "3" });
});
