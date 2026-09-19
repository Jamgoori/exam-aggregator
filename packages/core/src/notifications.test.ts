import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isNotificationType,
  notificationMessage,
  notificationPreview,
  relativeTimeLabel,
  safeNotificationLink,
  unreadBadgeLabel,
  NOTIFICATION_PREVIEW_MAX,
} from "./notifications";

test("알림 종류 판별", () => {
  assert.equal(isNotificationType("board_reply"), true);
  assert.equal(isNotificationType("everything"), false);
});

test("알림 문구는 종류마다 다르다", () => {
  assert.match(notificationMessage("board_comment"), /글에 댓글/);
  assert.match(notificationMessage("board_reply"), /댓글에 답글/);
  assert.match(notificationMessage("suggestion_answer"), /답변/);
});

test("배지 숫자는 두 자리를 넘으면 눌린다", () => {
  assert.equal(unreadBadgeLabel(0), "");
  assert.equal(unreadBadgeLabel(-1), "");
  assert.equal(unreadBadgeLabel(7), "7");
  assert.equal(unreadBadgeLabel(99), "99");
  assert.equal(unreadBadgeLabel(100), "99+");
});

test("상대 시각", () => {
  const now = new Date("2026-09-04T12:00:00Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

  assert.equal(relativeTimeLabel(ago(30_000), now), "방금");
  assert.equal(relativeTimeLabel(ago(5 * 60_000), now), "5분 전");
  assert.equal(relativeTimeLabel(ago(3 * 3600_000), now), "3시간 전");
  assert.equal(relativeTimeLabel(ago(2 * 24 * 3600_000), now), "2일 전");
  // 일주일이 넘으면 날짜로 — "37일 전"은 아무도 안 센다.
  assert.equal(relativeTimeLabel("2026-08-01T00:00:00Z", now).length, 8);
  // 미래 시각(시계 어긋남)도 음수가 되지 않게 0으로 눌린다.
  assert.equal(relativeTimeLabel("2026-09-05T00:00:00Z", now), "방금");
  assert.equal(relativeTimeLabel("올바르지 않은 값", now), "");
});

test("알림 링크는 사이트 안 경로만 통과한다", () => {
  assert.equal(safeNotificationLink("/board/1#comment-2"), "/board/1#comment-2");
  // 사이트 밖으로 나가는 값은 전부 알림함으로 떨어뜨린다.
  assert.equal(safeNotificationLink("https://evil.com"), "/notifications");
  assert.equal(safeNotificationLink("//evil.com"), "/notifications");
  // 브라우저가 `\` 를 `/` 로 고쳐 읽어 프로토콜 상대 URL 이 되는 경로.
  assert.equal(safeNotificationLink("/\\evil.com"), "/notifications");
  // 파서가 먼저 지우는 문자를 끼워 검사를 피해가는 경로.
  assert.equal(safeNotificationLink("/\t/evil.com"), "/notifications");
  assert.equal(safeNotificationLink(null), "/notifications");
  assert.equal(safeNotificationLink(42), "/notifications");
});

// 알림 미리보기 — 예전 웹 lib/notifications.ts 의 것. Edge board-write 가 같은 함수로 자른다.
test("notificationPreview: 서식을 걷어내고 80자에서 자른다", () => {
  assert.equal(notificationPreview("<p>안녕  <b>세상</b></p>"), "안녕 세상");
  const long = "가".repeat(NOTIFICATION_PREVIEW_MAX + 5);
  assert.equal(notificationPreview(long), `${"가".repeat(NOTIFICATION_PREVIEW_MAX)}…`);
  assert.equal(notificationPreview("가".repeat(NOTIFICATION_PREVIEW_MAX)), "가".repeat(NOTIFICATION_PREVIEW_MAX));
});
