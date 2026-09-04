// 알림 공용 규칙.
//
// "내 글에 댓글이 달렸다 / 내 댓글에 답글이 달렸다"를 알려주는 최소한의 알림이다.
// 종류를 문자열 하나(type)로 두고 화면 문구를 여기서 만든다 — 문구를 저장해 두면
// 나중에 표현을 다듬을 때 이미 쌓인 알림만 옛말로 남는다.
//
// 알림은 **사건이 일어난 그 서버 액션 안에서** 만든다(별도 트리거·큐 없음).
// 알림 생성에 실패해도 원래 동작(댓글 등록)은 성공으로 끝내야 한다 — 알림은
// 곁다리인데 그것 때문에 댓글이 안 달리면 본말이 전도된다.

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

  const d = new Date(then);
  return `${d.getFullYear() % 100}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}
