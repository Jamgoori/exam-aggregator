import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublisherId } from "./adsense";

// 이 파싱 하나가 틀리면 두 군데가 조용히 망가진다: 로더 스크립트의 client 가 어긋나
// 광고가 안 나오고, /ads.txt 한 줄이 애드센스에 "확인되지 않은 게시자"로 남는다.
// 화면에 에러가 뜨지 않으므로 여기에 형태를 못박아 둔다.

test("애드센스 화면에서 복사해 오는 세 형태를 모두 받는다", () => {
  // "코드 가져오기"의 스크립트에는 ca- 가 붙어 있고,
  assert.equal(parsePublisherId("ca-pub-1234567890123456"), "1234567890123456");
  // ads.txt 안내에는 붙어 있지 않고,
  assert.equal(parsePublisherId("pub-1234567890123456"), "1234567890123456");
  // 계정 정보에는 숫자만 있는 자리도 있다.
  assert.equal(parsePublisherId("1234567890123456"), "1234567890123456");
  // 붙여 넣을 때 흔히 따라오는 앞뒤 공백·대문자.
  assert.equal(parsePublisherId("  CA-PUB-1234567890123456 "), "1234567890123456");
});

test("형식이 어긋나면 null — 잘못된 ID 로 광고를 켜지 않는다", () => {
  assert.equal(parsePublisherId(""), null);
  assert.equal(parsePublisherId(null), null);
  assert.equal(parsePublisherId(undefined), null);
  // 자리를 비워 둔 안내 문구가 그대로 들어오는 사고.
  assert.equal(parsePublisherId("ca-pub-XXXXXXXXXXXXXXXX"), null);
  assert.equal(parsePublisherId("ca-pub-"), null);
  // 숫자 사이에 하이픈·공백이 섞이면 ID 가 아니다.
  assert.equal(parsePublisherId("1234-5678-9012-3456"), null);
  // 광고주(AdWords) ID 처럼 다른 접두사를 붙여 온 경우.
  assert.equal(parsePublisherId("ca-app-pub-1234567890123456"), null);
  // 자리수가 터무니없이 짧은 값.
  assert.equal(parsePublisherId("pub-123"), null);
});
