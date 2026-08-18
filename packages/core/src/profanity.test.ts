import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  containsProfanity,
  findProfanity,
  PROFANITY_ALLOWED_PHRASES,
  PROFANITY_WORDS,
} from "./profanity";

// 비속어 목록은 두 곳에 있다: 웹 서버 액션이 쓰는 여기(core)와, 앱이 호출하는 Edge
// Function 이 쓰는 supabase/functions/_shared/profanity.ts(Deno 라 core 를 import 할 수
// 없어 사본). 두 목록이 갈리면 앱에서만 통과하는 구멍이 생기므로 대조한다.
test("Edge Function 사본의 목록이 core 와 같다", () => {
  const copyPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "supabase",
    "functions",
    "_shared",
    "profanity.ts",
  );
  const copy = readFileSync(copyPath, "utf8");

  const arrayValues = (source: string, name: string): string[] => {
    const marker = `export const ${name} = [`;
    const start = source.indexOf(marker);
    assert.ok(start > 0, `${name} 배열을 찾지 못했다`);
    const end = source.indexOf("\n];", start);
    return [...source.slice(start + marker.length, end).matchAll(/"([^"]*)"/g)].map(
      (m) => m[1],
    );
  };

  assert.deepEqual(arrayValues(copy, "PROFANITY_WORDS"), PROFANITY_WORDS);
  assert.deepEqual(
    arrayValues(copy, "PROFANITY_ALLOWED_PHRASES"),
    PROFANITY_ALLOWED_PHRASES,
  );
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
