// theme.css(정본) 블록 파서. gen.mjs 와 테스트가 함께 쓴다.
// 행 번호가 아니라 셀렉터/at-rule 머리말 + 중괄호 짝으로 블록을 잘라내므로,
// 주석이 늘거나 순서가 바뀌어도 깨지지 않는다.

/** 정본이 반드시 담고 있어야 하는 다섯 블록의 머리말(공백 정규화 후 비교). */
export const BLOCK_SIGNATURES = [
  ":root {",
  "@theme inline {",
  "@theme {",
  '[data-theme="dark"] {',
  "@media (prefers-color-scheme: dark) {",
];

/** `/* … *\/` 주석을 지운다(문자열 리터럴은 토큰 CSS 에 없다). */
export function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/**
 * `prefix` 로 시작하는 최상위 블록을 찾아 `{ … }` 안쪽 텍스트를 돌려준다.
 * 같은 머리말이 여러 번 나오면 배열의 순서대로(첫 번째만 필요하면 [0]).
 */
export function findBlocks(css, prefix) {
  const clean = stripComments(css);
  const out = [];
  let from = 0;
  for (;;) {
    const at = indexOfSignature(clean, prefix, from);
    if (at < 0) break;
    const open = clean.indexOf("{", at);
    const close = matchBrace(clean, open);
    out.push({ start: at, end: close + 1, body: clean.slice(open + 1, close) });
    from = close + 1;
  }
  return out;
}

/** 블록 머리말이 "행의 시작(공백 제외)" 에서 나오는 위치를 찾는다(중첩 셀렉터 오탐 방지). */
function indexOfSignature(css, prefix, from) {
  const head = prefix.replace(/\s*\{$/, "");
  const re = new RegExp(`(^|\\n)[ \\t]*${escapeRe(head)}[ \\t]*\\{`, "g");
  re.lastIndex = from;
  const m = re.exec(css);
  if (!m) return -1;
  return m.index + m[1].length;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchBrace(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`중괄호 짝이 맞지 않음 (offset ${open})`);
}

/** 블록 본문에서 `name: value;` 선언을 { name: value } 로 (중첩 블록은 무시). */
export function parseDeclarations(body) {
  const decls = {};
  const flat = stripNested(body);
  for (const part of flat.split(";")) {
    const idx = part.indexOf(":");
    if (idx < 0) continue;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (name) decls[name] = value;
  }
  return decls;
}

function stripNested(body) {
  let out = "";
  let depth = 0;
  for (const ch of body) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0) out += ch;
  }
  return out;
}

/** `:root:not([data-theme]) {…}` 처럼 @media 안쪽의 중첩 블록. */
export function findNestedBlock(body, prefix) {
  const blocks = findBlocks(body, prefix);
  if (blocks.length === 0) throw new Error(`중첩 블록 없음: ${prefix}`);
  return blocks[0];
}

const SHADES = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"];
const HEX = /^#[0-9a-f]{6}$/;

function requireBlock(css, prefix) {
  const blocks = findBlocks(css, prefix);
  if (blocks.length !== 1) {
    throw new Error(`theme.css 에 '${prefix}' 블록이 ${blocks.length}개 (정확히 1개여야 함)`);
  }
  return blocks[0];
}

function pickBlue(decls, required) {
  const blue = {};
  for (const shade of SHADES) {
    const v = decls[`--color-blue-${shade}`];
    if (v === undefined) {
      if (required) throw new Error(`--color-blue-${shade} 누락`);
      continue;
    }
    if (!HEX.test(v)) throw new Error(`--color-blue-${shade} 값이 6자리 hex 가 아님: ${v}`);
    blue[shade] = v;
  }
  return blue;
}

function pickBase(decls, required) {
  const out = {};
  for (const [key, prop] of [
    ["background", "--background"],
    ["foreground", "--foreground"],
    ["colorScheme", "color-scheme"],
  ]) {
    const v = decls[prop];
    if (v === undefined) {
      if (required) throw new Error(`${prop} 누락`);
      continue;
    }
    if (key !== "colorScheme" && !HEX.test(v)) throw new Error(`${prop} 값이 6자리 hex 가 아님: ${v}`);
    if (key === "colorScheme" && v !== "light" && v !== "dark") throw new Error(`color-scheme 값 이상: ${v}`);
    out[key] = v;
  }
  return out;
}

/**
 * theme.css 전체 → { light, dark } (완전 해석된 hex).
 * dark 는 light 위에 `[data-theme="dark"]` 오버라이드를 덮은 값.
 * `@media (prefers-color-scheme: dark)` 의 `:root:not([data-theme])` 는
 * `[data-theme="dark"]` 와 선언이 같아야 한다(둘이 갈라지면 JS 전/후 색이 다름).
 */
export function parseTheme(css) {
  const root = parseDeclarations(requireBlock(css, ":root {").body);
  const themeInline = parseDeclarations(requireBlock(css, "@theme inline {").body);
  const theme = parseDeclarations(requireBlock(css, "@theme {").body);
  const dark = parseDeclarations(requireBlock(css, '[data-theme="dark"] {').body);
  const media = requireBlock(css, "@media (prefers-color-scheme: dark) {");
  const system = parseDeclarations(findNestedBlock(media.body, ":root:not([data-theme]) {").body);

  if (themeInline["--color-background"] !== "var(--background)" || themeInline["--color-foreground"] !== "var(--foreground)") {
    throw new Error("@theme inline 은 --color-background/--color-foreground 를 var(--background)/var(--foreground) 로 매핑해야 함");
  }
  const darkKeys = Object.keys(dark).sort();
  const systemKeys = Object.keys(system).sort();
  if (JSON.stringify(darkKeys) !== JSON.stringify(systemKeys) || darkKeys.some((k) => dark[k] !== system[k])) {
    throw new Error('[data-theme="dark"] 와 @media prefers-color-scheme: dark 의 선언이 다름');
  }

  const light = { ...pickBase(root, true), blue: pickBlue(theme, true) };
  const darkOverrides = { ...pickBase(dark, true), blue: pickBlue(dark, false) };
  const darkResolved = {
    ...light,
    ...darkOverrides,
    blue: { ...light.blue, ...darkOverrides.blue },
  };
  return { light, dark: darkResolved };
}
