import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authorNickname,
  BANNED_SUBSTRINGS,
  FALLBACK_NICKNAME,
  NICKNAME_MAX,
  validateNickname,
} from "./nickname";

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

// 작성자 표시 이름의 폴백이 이메일 로컬파트로 떨어지면, 그 값은 닉네임 정책을 한 번도
// 통과하지 않은 채 공개 댓글에 박힌다("관리자@…" → "관리자" 사칭). 폴백은 중립 기본값이어야
// 한다. 이 값은 supabase/functions/comments-write/index.ts 에도 같은 규칙으로 복사돼 있다.
test("작성자 이름 폴백은 이메일이 아니라 중립 기본값", () => {
  assert.equal(authorNickname(undefined), FALLBACK_NICKNAME);
  assert.equal(authorNickname(null), FALLBACK_NICKNAME);
  assert.equal(authorNickname(""), FALLBACK_NICKNAME);
  assert.equal(authorNickname("   "), FALLBACK_NICKNAME);
  // 닉네임을 설정한 계정은 그 값을 그대로 쓴다(트리거가 이미 정책을 강제했다).
  assert.equal(authorNickname("공시생"), "공시생");
  assert.equal(authorNickname("  공시생  "), "공시생");
  // 상한은 comments_nickname_len(10자) 과 같아야 DB 제약에 걸리지 않는다.
  assert.equal(authorNickname("가".repeat(30)).length, NICKNAME_MAX);
});
