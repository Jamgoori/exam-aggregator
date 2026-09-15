#!/usr/bin/env node
// packages/core → supabase/functions/_shared/core.mjs 번들.
//
// Edge Function(Deno)은 워크스페이스 패키지를 import 하지 못한다. 그래서 예전엔 srs·
// review-pick·profanity·status·membership·attendance … 를 _shared/ 에 한 벌씩 손으로
// 옮겨 적었고, 한쪽만 고치면 웹과 앱의 복습일·출석·한도가 조용히 어긋났다. 이 스크립트가
// src/server.ts(서버 규칙 + Edge 가 쓰는 순수 규칙)를 esbuild 로 단일 ESM 에 묶어 그
// 사본들을 대체한다(설계서 §3.2). 생성물은 커밋하고 CI 가 --check 로 diff 0 을 검사한다.
//
//   node scripts/bundle-edge.mjs            생성(core.mjs + core.d.ts + core-types/)
//   node scripts/bundle-edge.mjs --check    메모리에 다시 만들어 커밋본과 다르면 exit 1
//   node scripts/bundle-edge.mjs --watch    src 변경 시 재생성(개발용)
//
// 검사 항목(--check 와 생성 모두):
//   · 출력에 `import ` 구문이 0개 — external(@supabase/supabase-js) 참조조차 없어야 한다.
//     Edge 는 https://esm.sh/@supabase/supabase-js@2 를 따로 읽으므로 이중 로드 금지.
//     core 는 supabase-js 를 `import type` 으로만 쓴다(값 import 가 생기면 여기서 걸린다).
//   · `esm.sh`·`node_modules` 문자열 없음 — 외부 런타임 의존이 새지 않았는지.
//
// 타입: Deno 쪽 계약 검사를 위해 tsc --emitDeclarationOnly 로 core-types/ 에 .d.ts 를 내고,
// _shared/core.d.ts 가 그 진입점(server.d.ts)을 다시 내보낸다. Deno 는 확장자 없는 상대
// 경로를 못 푸므로 emitted .d.ts 안의 상대 import 에 `.d.ts` 를 붙여 준다.
// `@supabase/supabase-js` 타입 import 는 supabase/functions/deno.json 의 import map 이 푼다.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import esbuild from "esbuild";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(here, "..");
const repoRoot = resolve(coreDir, "../..");
const entry = join(coreDir, "src/server.ts");
const outDir = join(repoRoot, "supabase/functions/_shared");
const outFile = join(outDir, "core.mjs");
const typesEntryFile = join(outDir, "core.d.ts");
const typesDir = join(outDir, "core-types");
const typesTsconfig = join(coreDir, "tsconfig.edge-types.json");

const BANNER = `// 생성물 — 손으로 고치지 말 것; npm run bundle-edge -w @gongmoa/core
// 원본: packages/core/src/server.ts (esbuild 번들, format=esm, platform=neutral, target=es2022)
// Edge Function 은 이 파일만 import 한다. 규칙을 바꾸려면 packages/core/src 를 고치고 다시 생성.`;

const TYPES_ENTRY = `// 생성물 — 손으로 고치지 말 것; npm run bundle-edge -w @gongmoa/core
// core.mjs 의 타입 진입점. Edge 파일은 import 앞에 \`// @ts-types="../_shared/core.d.ts"\` 를 둔다.
export * from "./core-types/server.d.ts";
`;

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const watch = args.has("--watch");

async function build() {
  const result = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    format: "esm",
    platform: "neutral",
    target: "es2022",
    external: ["@supabase/supabase-js"],
    banner: { js: BANNER },
    // 한글 문자열(오류 문구·비속어 목록)을 \uXXXX 로 바꾸지 않는다 — diff 를 사람이 읽어야 한다.
    charset: "utf8",
    legalComments: "none",
    logLevel: "silent",
  });
  const code = result.outputFiles[0].text;
  verify(code);
  return code;
}

function verify(code) {
  const problems = [];
  // banner 안의 "import 한다" 같은 한글 문장은 걸리지 않게 실제 구문만 본다.
  if (/^\s*import\s[^;]*from\s|^\s*import\s*["']/m.test(code)) {
    problems.push("import 구문이 남아 있다 — core 에 값 import 가 생겼는지 확인(supabase-js 는 import type 만)");
  }
  if (code.includes("esm.sh")) problems.push("esm.sh 문자열이 들어 있다");
  if (code.includes("node_modules")) problems.push("node_modules 문자열이 들어 있다");
  if (problems.length > 0) {
    for (const p of problems) console.error(`bundle-edge: ${p}`);
    process.exit(1);
  }
}

// ── 타입 선언 ────────────────────────────────────────────────────────────────

function emitTypes(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const tsc = join(repoRoot, "node_modules/.bin/tsc");
  const r = spawnSync(
    tsc,
    ["-p", typesTsconfig, "--declarationDir", dir],
    { cwd: coreDir, stdio: "inherit" },
  );
  if (r.status !== 0) {
    console.error("bundle-edge: tsc --emitDeclarationOnly 실패");
    process.exit(1);
  }
  // Deno 용으로 상대 import 에 확장자를 붙인다.
  for (const file of walk(dir)) {
    const src = readFileSync(file, "utf8");
    const fixed = src.replace(
      /(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+?)\2/g,
      (_m, pre, q, spec) => `${pre}${q}${spec.endsWith(".d.ts") ? spec : `${spec}.d.ts`}${q}`,
    );
    if (fixed !== src) writeFileSync(file, fixed);
  }
}

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out.sort();
}

function snapshot(dir) {
  const map = new Map();
  if (!existsSync(dir)) return map;
  for (const f of walk(dir)) map.set(relative(dir, f), readFileSync(f, "utf8"));
  return map;
}

// ── 실행 ────────────────────────────────────────────────────────────────────

async function generate() {
  const code = await build();
  mkdirSync(outDir, { recursive: true });
  writeFileSync(outFile, code);
  emitTypes(typesDir);
  writeFileSync(typesEntryFile, TYPES_ENTRY);
  console.log(
    `bundle-edge: ${relative(repoRoot, outFile)} (${(code.length / 1024).toFixed(1)} KB), ` +
      `${relative(repoRoot, typesDir)}/ (${walk(typesDir).length} files)`,
  );
}

async function runCheck() {
  const code = await build();
  const committed = existsSync(outFile) ? readFileSync(outFile, "utf8") : null;
  let dirty = false;
  if (committed !== code) {
    console.error(`bundle-edge --check: ${relative(repoRoot, outFile)} 가 원본과 다르다`);
    dirty = true;
  }
  if (!existsSync(typesEntryFile) || readFileSync(typesEntryFile, "utf8") !== TYPES_ENTRY) {
    console.error(`bundle-edge --check: ${relative(repoRoot, typesEntryFile)} 가 원본과 다르다`);
    dirty = true;
  }
  const tmp = join(tmpdir(), `gongmoa-core-types-${process.pid}`);
  try {
    emitTypes(tmp);
    const want = snapshot(tmp);
    const have = snapshot(typesDir);
    const keys = new Set([...want.keys(), ...have.keys()]);
    for (const k of [...keys].sort()) {
      if (want.get(k) !== have.get(k)) {
        console.error(`bundle-edge --check: ${relative(repoRoot, join(typesDir, k))} 가 원본과 다르다`);
        dirty = true;
      }
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  if (dirty) {
    console.error("→ `npm run bundle-edge -w @gongmoa/core` 를 돌리고 결과를 커밋할 것");
    process.exit(1);
  }
  console.log("bundle-edge --check: 최신");
}

if (check) {
  await runCheck();
} else if (watch) {
  await generate();
  const { watch: fsWatch } = await import("node:fs");
  let timer = null;
  fsWatch(join(coreDir, "src"), { recursive: true }, () => {
    clearTimeout(timer);
    timer = setTimeout(() => generate().catch((e) => console.error(e)), 150);
  });
  console.log("bundle-edge: watching packages/core/src …");
} else {
  await generate();
}
