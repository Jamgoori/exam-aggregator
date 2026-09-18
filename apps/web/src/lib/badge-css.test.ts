import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import {
  EXAM_TYPE_FILLED_CLASSES,
  EXAM_TYPE_OUTLINE_CLASSES,
  EXAM_TYPE_TAB_CLASSES,
  LEVEL_CLASSES,
  PAPERS_GROUP_CLASSES,
  ROUND_TIER_STYLES,
  STREAK_TIER_CLASSES,
  SUBJECT_PALETTE_CLASSES,
} from "@gongmoa/core";

// 배지 색의 정본은 packages/core/src/badge-classes.ts 인데, Tailwind v4 의 자동 소스
// 탐지는 CSS 가 놓인 앱(apps/web) 아래만 훑고 node_modules(=워크스페이스 심볼릭 링크)
// 는 건너뛴다. 그래서 그 파일에만 적힌 클래스는 CSS 가 아예 생성되지 않은 채로
// 배포됐다 — 지방직(bg-emerald-700)·계리직(bg-lime-700) 배지는 배경 없이 text-white
// 만 남아 흰 카드 위에서 글자째 사라졌고, 회독 배지는 그라데이션 없는 맨 글씨였다.
// globals.css 의 @source 한 줄이 그걸 고치는데, 지우거나 경로가 어긋나도 빌드는
// 멀쩡히 성공하고 화면에서만 조용히 사라진다. 그래서 여기서 실제로 컴파일해 본다.

// CSS.escape 와 같은 규칙 — [a-zA-Z0-9_-] 와 비ASCII 를 뺀 나머지에 백슬래시를 붙인다.
// Tailwind 가 `ring-white/80` 을 `.ring-white\/80` 으로 내보내는 그 규칙이다.
function escapeClass(name: string): string {
  return name.replace(/[^\w-]/gu, (ch) => (ch.charCodeAt(0) > 127 ? ch : `\\${ch}`));
}

function classNames(): string[] {
  const sources = [
    ...Object.values(LEVEL_CLASSES),
    ...Object.values(EXAM_TYPE_OUTLINE_CLASSES),
    ...Object.values(EXAM_TYPE_TAB_CLASSES),
    ...Object.values(EXAM_TYPE_FILLED_CLASSES),
    ...Object.values(PAPERS_GROUP_CLASSES),
    ...SUBJECT_PALETTE_CLASSES,
    ...Object.values(ROUND_TIER_STYLES).map((tier) => tier.className),
    ...Object.values(STREAK_TIER_CLASSES),
  ];
  return [...new Set(sources.flatMap((value) => value.split(/\s+/)).filter(Boolean))];
}

test("core 배지 맵의 클래스가 전부 globals.css 에서 생성된다", async () => {
  const from = path.join(process.cwd(), "src/app/globals.css");
  const css = await readFile(from, "utf8");
  // optimize 를 끄면 셀렉터가 합쳐지지 않아 클래스 하나하나를 그대로 찾을 수 있다.
  const built = await postcss([tailwind({ optimize: false })]).process(css, { from });

  const missing = classNames().filter((name) => !built.css.includes(`.${escapeClass(name)}`));
  assert.deepEqual(
    missing,
    [],
    `globals.css 의 @source 가 packages/core/src 를 덮고 있는지 확인할 것. 빠진 클래스: ${missing.join(", ")}`,
  );
});
