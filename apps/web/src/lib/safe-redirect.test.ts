import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeNextPath } from "./safe-redirect";

// 이 함수가 돌려준 값은 곧바로 new URL(next, origin) 이나 <Link href> 로 들어간다.
// 그래서 "무슨 문자열을 돌려줬는가"가 아니라 **"그 문자열이 어느 주소로 해석되는가"**
// 를 검사한다 — 예전 구현은 문자열 검사만 통과시키고 파서 단계에서 밖으로 나갔다.
const SITE = "https://gongmoa.kr";

function resolved(next: string | null | undefined): string {
  return new URL(sanitizeNextPath(next), SITE).origin;
}

test("사이트 안 경로는 그대로 둔다", () => {
  assert.equal(sanitizeNextPath("/mypage"), "/mypage");
  assert.equal(sanitizeNextPath("/papers/2024-국가직-9급?tab=1"), "/papers/2024-국가직-9급?tab=1");
  assert.equal(sanitizeNextPath(null), "/");
  assert.equal(sanitizeNextPath(""), "/");
});

test("절대 주소·프로토콜 상대 주소는 루트로 되돌린다", () => {
  assert.equal(sanitizeNextPath("https://evil.com"), "/");
  assert.equal(sanitizeNextPath("//evil.com"), "/");
  assert.equal(sanitizeNextPath("/\\evil.com"), "/");
});

// URL 파서는 파싱 전에 탭·개행을 지운다. 그 전에 지워두지 않으면 "/\t/evil.com" 이
// 접두사 검사를 통과한 뒤 "//evil.com" 으로 되살아나 외부로 나간다.
test("탭·개행을 끼워 넣어도 밖으로 나가지 않는다", () => {
  for (const c of ["\t", "\n", "\r"]) {
    assert.equal(resolved(`/${c}/evil.com`), SITE, `${JSON.stringify(c)} + //`);
    assert.equal(resolved(`/${c}\\evil.com`), SITE, `${JSON.stringify(c)} + backslash`);
    assert.equal(resolved(`${c}//evil.com`), SITE, `leading ${JSON.stringify(c)}`);
  }
  // 여러 개를 흩뿌려도 마찬가지.
  assert.equal(resolved("/\t/\tevil.com"), SITE);
  assert.equal(resolved("/\r\n/evil.com"), SITE);
});

test("정상 경로에 섞인 탭·개행은 지우고 경로는 살린다", () => {
  assert.equal(sanitizeNextPath("/my\tpage"), "/mypage");
  assert.equal(resolved("/mypage"), SITE);
});
