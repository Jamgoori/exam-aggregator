import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BANNED_SUBSTRINGS, validateNickname } from "./nickname";

// 닉네임 금칙어는 두 곳에서 검사한다: 화면에 바로 알려주려고 여기(클라이언트)에서 한 번,
// REST 로 auth.updateUser 를 직접 불러 우회하는 걸 막으려고 DB 트리거에서 한 번.
// 두 목록이 갈리면 DB 만 통과시키는 구멍이 생기므로 여기서 대조한다.
test("DB 트리거 금칙어 목록이 core 목록과 같다", () => {
  const schemaPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "supabase",
    "schema.sql",
  );
  const schema = readFileSync(schemaPath, "utf8");

  const marker = "foreach banned in array array[";
  const start = schema.indexOf(marker);
  assert.ok(start > 0, "schema.sql 에서 금칙어 배열을 찾지 못했다");
  const end = schema.indexOf("] loop", start);
  const body = schema.slice(start + marker.length, end);

  // SQL 문자열 리터럴에서 값만 뽑는다('' 는 작은따옴표 이스케이프).
  const inSql = [...body.matchAll(/'((?:[^']|'')*)'/g)].map((m) =>
    m[1].replace(/''/g, "'"),
  );

  assert.deepEqual(
    inSql,
    BANNED_SUBSTRINGS,
    "schema.sql 의 금칙어 목록이 core 와 다르다 — 한쪽만 고치면 DB 가 통과시키는 닉네임이 생긴다",
  );
});

test("관리자 사칭·비속어 닉네임을 막는다", () => {
  for (const nick of ["관리자", "공모아운영자", "admin", "AdMiN", "관 리 자", "씨1발"]) {
    assert.notEqual(validateNickname(nick).error, null, `막혀야 함: ${nick}`);
  }
});

test("평범한 닉네임은 통과한다", () => {
  for (const nick of ["공시생A", "합격기원", "hello"]) {
    assert.equal(validateNickname(nick).error, null, nick);
  }
});

test("길이 규칙", () => {
  assert.notEqual(validateNickname("가").error, null);
  assert.notEqual(validateNickname("가".repeat(11)).error, null);
  assert.equal(validateNickname("가나").error, null);
});
