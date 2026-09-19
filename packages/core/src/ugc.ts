// 사용자 생성 콘텐츠(UGC) 신고·차단의 공용 규칙(순수).
//
// 스토어 심사 요건(Apple 1.2 — 사용자가 만든 콘텐츠가 있는 앱은 신고·차단 수단이 있어야
// 한다)으로 들어온 기능이라 웹에는 없던 것이다. 소유자 결정(설계서 §12-2 #16)으로 웹에도
// 함께 넣는다. 쓰기는 전부 SD RPC(report_post·block_user·unblock_user — schema.sql
// "Phase 5 1라운드" 절)이고 앱·웹은 그 함수를 부르기만 한다. 여기에는 화면이 그릴 사유
// 목록과 인자 검증만 둔다.

// 신고 사유. slug 는 DB(board_post_reports.reason)와 RPC 인자에 그대로 쓰이므로 바꾸지 말 것.
//
// ⚠ 두 곳을 함께 고친다: 이 배열과 schema.sql 의 `board_post_reports_reason_check`
// (그리고 report_post 본문의 `p_reason not in (...)`). notifications_type_check 와 같은
// 관례다 — 한쪽만 고치면 화면에서 고른 사유가 DB 에서 거절돼 "신고에 실패했어요"만 남는다.
export const REPORT_REASONS = [
  { slug: "spam", label: "스팸·광고" },
  { slug: "abuse", label: "욕설·혐오" },
  { slug: "sexual", label: "음란물" },
  { slug: "privacy", label: "개인정보 노출" },
  { slug: "other", label: "기타" },
] as const;

export type ReportReasonSlug = (typeof REPORT_REASONS)[number]["slug"];

export function isReportReason(value: unknown): value is ReportReasonSlug {
  return REPORT_REASONS.some((r) => r.slug === value);
}

export function reportReasonLabel(slug: string): string {
  return REPORT_REASONS.find((r) => r.slug === slug)?.label ?? "기타";
}

// 신고 상세 설명의 길이 상한. DB check(char_length(detail) <= 500)와 같은 값 — 여기서 먼저
// 막아야 오류 문구가 SQL 메시지가 아니라 사람 말로 나간다.
export const REPORT_DETAIL_MAX = 500;

// 신고 폼 검증. RPC report_post 본문이 같은 검사를 되풀이한다(SD 공통 규칙 (4)).
// "기타"는 상세 설명이 있어야 운영자가 무엇을 봐야 할지 알 수 있다 — 다른 사유는 선택.
export function validateReportInput(input: {
  reason: string;
  detail?: string | null;
}): { error: string } | { reason: ReportReasonSlug; detail: string | null } {
  if (!isReportReason(input.reason)) return { error: "신고 사유를 선택해주세요." };
  const detail = String(input.detail ?? "").trim();
  if (detail.length > REPORT_DETAIL_MAX) {
    return { error: `상세 설명은 ${REPORT_DETAIL_MAX}자 이하로 입력해주세요.` };
  }
  if (input.reason === "other" && !detail) {
    return { error: "기타 사유는 내용을 적어주세요." };
  }
  return { reason: input.reason, detail: detail || null };
}

// 차단 목록으로 목록을 거른다. 게시글·댓글 어느 쪽이든 작성자 id 만 있으면 된다.
// 차단은 **내가 보는 화면**에서만 사라지는 것이고(상대는 모른다), 서버 RLS 는 건드리지
// 않는다 — 차단 목록은 user_blocks 의 "select own" 으로 읽는다.
export function filterBlocked<T extends { authorId: string }>(
  items: readonly T[],
  blockedIds: ReadonlySet<string> | readonly string[],
): T[] {
  const set = blockedIds instanceof Set ? blockedIds : new Set(blockedIds as readonly string[]);
  if (set.size === 0) return [...items];
  return items.filter((item) => !set.has(item.authorId));
}
