import { KST_TIME_ZONE, kstDayKey } from "@gongmoa/core";

// 자유게시판의 날짜 표기 세 벌 — 웹 board/page.tsx·board/[id]/page.tsx·board-comments.tsx 의
// formatDate/formatDateTime 을 그대로 옮긴 것. 시각은 언제나 한국 시간으로 그린다(core KST_TIME_ZONE
// 주석) — 기기 시간대가 다른 사람이 봐도 웹과 같은 시각이 보여야 한다.

// 목록 줄: 오늘 글은 시:분으로 — 게시판에서 "방금 올라온 글"이 눈에 띄어야 한다. "오늘인가" 판정은
// 기기 시간대가 아니라 KST 날짜 키로 한다(웹과 같은 이유).
export function formatBoardListDate(iso: string): string {
  const d = new Date(iso);
  const sameDay = kstDayKey(d) === kstDayKey(new Date());
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { timeZone: KST_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE, year: "2-digit", month: "2-digit", day: "2-digit" });
}

// 글 머리: 네 자리 연도까지(웹 board/[id]/page.tsx formatDateTime).
export function formatBoardPostDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 댓글 줄: 두 자리 연도(웹 board-comments.tsx formatDateTime).
export function formatBoardCommentDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
