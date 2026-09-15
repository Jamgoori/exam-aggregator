import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  containsProfanity,
  findProfanity,
  PROFANITY_ALLOWED_PHRASES,
  PROFANITY_WORDS,
} from "./profanity";

// 비속어 목록의 정본은 여기(core) 하나다. 앱이 호출하는 Edge Function 은
// supabase/functions/_shared/core.mjs(이 패키지의 esbuild 번들)로 같은 목록을 받고,
// 예전 사본 _shared/profanity.ts 는 삭제됐다(2026-09-15). 여기서는 (1) 사본 파일이 다시
// 생기지 않았는지, (2) 커밋된 번들이 지금 목록과 같은지 대조한다 — 번들을 안 돌리고 목록만
// 고치면 앱에서만 통과하는 구멍이 된다.
test("Edge Function 번들의 목록이 core 와 같다", async () => {
  const sharedDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "supabase",
    "functions",
    "_shared",
  );
  assert.equal(
    existsSync(join(sharedDir, "profanity.ts")),
    false,
    "_shared/profanity.ts 사본을 다시 만들지 말 것 — Edge 는 core.mjs 만 import 한다",
  );

  const bundle = (await import(pathToFileURL(join(sharedDir, "core.mjs")).href)) as {
    PROFANITY_WORDS: readonly string[];
    PROFANITY_ALLOWED_PHRASES: readonly string[];
  };
  assert.deepEqual([...bundle.PROFANITY_WORDS], [...PROFANITY_WORDS]);
  assert.deepEqual([...bundle.PROFANITY_ALLOWED_PHRASES], [...PROFANITY_ALLOWED_PHRASES]);
});

test("욕설이 섞인 글을 잡는다", () => {
  for (const text of [
    "이 문제 진짜 씨발 뭐냐",
    "출제자 병신인가",
    "ㅅㅂ 난이도 실화냐",
    "this is fucking hard",
    "개소리 하지 마세요",
  ]) {
    assert.equal(containsProfanity(text), true, `막혀야 함: ${text}`);
  }
});

test("숫자·기호를 끼워 넣는 우회를 잡는다", () => {
  for (const text of ["시1발 어렵다", "씨*발", "이 문제 병.신 같음", "f.u.c.k this"]) {
    assert.equal(containsProfanity(text), true, `막혀야 함: ${text}`);
  }
});

test("멀쩡한 글은 통과한다", () => {
  for (const text of [
    "이 문제 정말 어렵네요. 다들 화이팅!",
    "응시 발표 언제 나오나요?",
    "실시 발생 시점을 묻는 문제입니다",
    "이 사건이 논쟁의 시발점이 되었습니다",
    "3번이 답 아닌가요? 해설 부탁드려요",
    "관리자님 오탈자 신고합니다",
  ]) {
    assert.equal(findProfanity(text), null, `통과해야 함: ${text} (${findProfanity(text)})`);
  }
});

test("빈 값은 통과한다", () => {
  assert.equal(containsProfanity(""), false);
  assert.equal(containsProfanity("   "), false);
});
