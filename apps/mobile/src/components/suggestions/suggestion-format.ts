import { KST_TIME_ZONE, kstDayKey } from "@gongmoa/core";

// 건의게시판의 날짜 표기 두 벌 — 웹 suggestions/page.tsx 의 formatDate 와 suggestions/[id]/page.tsx·
// suggestion-comments.tsx 의 formatDateTime(둘이 같은 형식)을 그대로 옮긴 것. 시각은 언제나 한국 시간으로
// 그린다(core KST_TIME_ZONE 주석) — 기기 시간대가 다른 사람이 봐도 웹과 같은 시각이 보여야 한다.

// 목록 줄: 오늘 글은 시:분으로 — 게시판에서 "방금 올라온 글"이 눈에 띄어야 한다. "오늘인가" 판정은 기기
// 시간대가 아니라 KST 날짜 키로 한다(웹 주석 — Date 의 getDate 는 실행 환경 시간대를 따라서 자정 근처 글의
// "오늘" 판정이 어긋난다).
export function formatSuggestionListDate(iso: string): string {
  const d = new Date(iso);
  const sameDay = kstDayKey(d) === kstDayKey(new Date());
  return sameDay
    ? d.toLocaleTimeString("ko-KR", { timeZone: KST_TIME_ZONE, hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE, year: "2-digit", month: "2-digit", day: "2-digit" });
}

// 상세 머리·운영자 답변·댓글 줄: 네 자리 연도까지.
export function formatSuggestionDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
