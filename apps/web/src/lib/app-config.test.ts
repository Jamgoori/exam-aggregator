import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBuildNumber, readAppConfig } from "./app-config";

test("환경변수가 하나도 없으면 전부 0·null 이다 (아무도 업데이트 화면에 갇히지 않는다)", () => {
  assert.deepEqual(readAppConfig({}), {
    minBuild: { ios: 0, android: 0 },
    latestBuild: { ios: 0, android: 0 },
    message: null,
    storeUrl: { ios: null, android: null },
  });
});

test("값이 있으면 그대로 읽는다", () => {
  assert.deepEqual(
    readAppConfig({
      APP_MIN_BUILD_IOS: "12",
      APP_MIN_BUILD_ANDROID: " 7 ",
      APP_LATEST_BUILD_IOS: "15",
      APP_LATEST_BUILD_ANDROID: "9",
      APP_UPDATE_MESSAGE: " 새 버전이 나왔어요 ",
      APP_STORE_URL_IOS: "https://apps.apple.com/app/id123",
      APP_STORE_URL_ANDROID: "https://play.google.com/store/apps/details?id=com.gongmoa.app",
    }),
    {
      minBuild: { ios: 12, android: 7 },
      latestBuild: { ios: 15, android: 9 },
      message: "새 버전이 나왔어요",
      storeUrl: {
        ios: "https://apps.apple.com/app/id123",
        android: "https://play.google.com/store/apps/details?id=com.gongmoa.app",
      },
    },
  );
});

test("빌드 번호는 음이 아닌 정수만 받고 그 밖은 0 이다", () => {
  assert.equal(parseBuildNumber("42"), 42);
  assert.equal(parseBuildNumber(" 42 "), 42);
  assert.equal(parseBuildNumber("0"), 0);
  assert.equal(parseBuildNumber(""), 0);
  assert.equal(parseBuildNumber(undefined), 0);
  assert.equal(parseBuildNumber(null), 0);
  assert.equal(parseBuildNumber("abc"), 0);
  assert.equal(parseBuildNumber("1.5"), 0);
  assert.equal(parseBuildNumber("-3"), 0);
  assert.equal(parseBuildNumber("1e3"), 0);
});

test("빈 문자열·공백 문자열은 null 이다", () => {
  const cfg = readAppConfig({ APP_UPDATE_MESSAGE: "   ", APP_STORE_URL_IOS: "" });
  assert.equal(cfg.message, null);
  assert.equal(cfg.storeUrl.ios, null);
});
