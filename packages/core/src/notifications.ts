// 알림 공용 규칙.
//
// "내 글에 댓글이 달렸다 / 내 댓글에 답글이 달렸다"를 알려주는 최소한의 알림이다.
// 종류를 문자열 하나(type)로 두고 화면 문구를 여기서 만든다 — 문구를 저장해 두면
// 나중에 표현을 다듬을 때 이미 쌓인 알림만 옛말로 남는다.
//
// 알림은 **사건이 일어난 그 서버 액션 안에서** 만든다(별도 트리거·큐 없음).
// 알림 생성에 실패해도 원래 동작(댓글 등록)은 성공으로 끝내야 한다 — 알림은
// 곁다리인데 그것 때문에 댓글이 안 달리면 본말이 전도된다.

import { kstDayKey } from "./format";
import { richTextToPlain } from "./rich-text";

export const NOTIFICATION_TYPES = [
  "board_comment", // 내 게시글에 댓글
  "board_reply", // 내 댓글에 답글
  "suggestion_comment", // 내 건의글에 댓글
  "suggestion_answer", // 내 건의글에 운영자 답변
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export function isNotificationType(value: unknown): value is NotificationType {
  return NOTIFICATION_TYPES.includes(value as NotificationType);
}

export type NotificationItem = {
  id: string;
  type: NotificationType;
  actorNickname: string;
  // 알림이 가리키는 글의 제목(그 시점 스냅샷). 글이 지워져도 "무엇에 달린
  // 알림이었는지"는 남아야 해서 join 하지 않고 박아둔다.
  title: string;
  preview: string;
  link: string;
  isRead: boolean;
  createdAt: string;
};

// 한 번에 내려주는 개수 — `/notifications` 한 페이지와 헤더 종의 최근 목록.
// 웹 `lib/notifications.ts` 는 `server-only` 라 앱이 import 할 수 없어서, 예전에는 두 곳에
// 같은 숫자를 적어두고 "같은 값이어야 한다"는 주석으로 묶어 뒀다. 한쪽만 바꾸면 종의
// "알림 전체보기"로 넘어갔을 때 목록이 어긋나므로(페이지 경계가 달라진다) 여기 한 벌만 둔다.
export const NOTIFICATIONS_PAGE_SIZE = 20;
export const NOTIFICATION_DROPDOWN_SIZE = 8;

// 알림 미리보기에 싣는 본문 길이. 길게 실으면 드롭다운이 한 화면을 넘긴다.
// 예전에는 웹 lib/notifications.ts 에만 있었다 — 앱이 Edge(board-write)로 댓글을 달면서
// 같은 사건의 알림이 두 경로에서 만들어지므로, 미리보기를 자르는 자리도 한 곳이어야
// 목록에서 웹 댓글과 앱 댓글의 알림이 같은 길이로 보인다.
export const NOTIFICATION_PREVIEW_MAX = 80;

// 댓글 본문(평문·HTML 모두)에서 알림 한 줄에 실을 미리보기를 만든다.
export function notificationPreview(content: string): string {
  const flat = richTextToPlain(content).replace(/\s+/g, " ").trim();
  return flat.length > NOTIFICATION_PREVIEW_MAX
    ? `${flat.slice(0, NOTIFICATION_PREVIEW_MAX)}…`
    : flat;
}

// 브라우저 URL 파서는 주소를 해석하기 **전에** 탭·개행을 지운다(safe-redirect.ts 의 긴 설명).
const URL_PARSER_STRIPPED = /[\t\n\r]/g;

// 알림 링크는 서버가 만든 사이트 내부 경로뿐이어야 한다. 행은 service_role 만 쓰지만(RLS),
// 혹시 다른 값이 들어 있어도 화면이 그 주소로 보내지 않게 한 번 더 좁힌다.
//
// 웹(`<Link href>`)과 앱(`router.push`)이 각자 판정하면 한쪽만 고쳤을 때 같은 행이 서로 다른
// 곳으로 열린다 — 판정도 기본값("/notifications")도 여기 한 벌이다.
//
// `//` 뿐 아니라 `/\` 와 탭·개행도 막는 것은 `sanitizeNextPath` 와 같은 이유다: 브라우저는
// URL 의 `\` 를 `/` 로 고쳐 읽으므로 `/\evil.com` 은 `//evil.com`(프로토콜 상대 URL)이 되어
// 사이트 밖으로 나간다. 지금은 여기 닿는 값이 전부 서버가 만든 경로지만, 이 함수의 존재
// 이유가 "그래도 혹시"이므로 검사한 문자열과 실제로 열리는 문자열을 같게 맞춰 둔다.
export function safeNotificationLink(link: unknown): string {
  if (typeof link !== "string") return "/notifications";
  const path = link.replace(URL_PARSER_STRIPPED, "");
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/\\")
    ? path
    : "/notifications";
}

// 알림 한 줄의 문구. "○○님이 …" 형태로 통일한다.
export function notificationMessage(type: NotificationType): string {
  switch (type) {
    case "board_comment":
      return "님이 회원님의 글에 댓글을 남겼어요";
    case "board_reply":
      return "님이 회원님의 댓글에 답글을 남겼어요";
    case "suggestion_comment":
      return "님이 회원님의 건의글에 댓글을 남겼어요";
    case "suggestion_answer":
      return "님이 회원님의 건의글에 답변했어요";
  }
}

// 종 아이콘 옆 배지 숫자. 두 자리를 넘으면 "99+"로 눌러 배지가 커지지 않게 한다.
export function unreadBadgeLabel(count: number): string {
  if (count <= 0) return "";
  return count > 99 ? "99+" : String(count);
}

// "3분 전" 같은 상대 시각. 알림 목록은 최근 것이 대부분이라 절대 시각보다 읽기 쉽다.
export function relativeTimeLabel(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const diffSec = Math.max(0, Math.floor((now.getTime() - then) / 1000));

  if (diffSec < 60) return "방금";
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}분 전`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour}시간 전`;
  const day = Math.floor(hour / 24);
  if (day < 7) return `${day}일 전`;

  // 일주일이 넘으면 날짜로 보여준다. getFullYear/getMonth/getDate 는 실행 환경의
  // 시간대를 따르므로 쓰지 않는다 — 서버(UTC)에서 그리면 하루가 어긋난다.
  const [year, month, dayOfMonth] = kstDayKey(new Date(then)).split("-");
  return `${year.slice(2)}.${month}.${dayOfMonth}`;
}
