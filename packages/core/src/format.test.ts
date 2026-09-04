import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCount, formatDuration, formatFileSize, kstDayKey } from "./format";

test("kstDayKey 는 서버 시간대와 무관하게 한국 날짜를 준다", () => {
  // UTC 로는 9/4 지만 한국은 이미 9/5 다 — 서버(UTC)에서 그리는 화면이 하루
  // 어긋나던 원인이 정확히 이 경계다.
  assert.equal(kstDayKey("2026-09-04T15:00:00Z"), "2026-09-05");
  assert.equal(kstDayKey("2026-09-04T14:59:59Z"), "2026-09-04");
  // 같은 순간이면 표기가 달라도 같은 날로 본다.
  assert.equal(kstDayKey("2026-09-05T00:00:00+09:00"), "2026-09-05");
  assert.equal(kstDayKey("이상한 값"), "");
});

test("기존 포맷 함수", () => {
  assert.equal(formatFileSize(null), null);
  assert.equal(formatFileSize(2 * 1024 * 1024), "2.0 MB");
  assert.equal(formatCount(12345), "12,345");
  assert.equal(formatDuration(125), "2분 5초");
});
