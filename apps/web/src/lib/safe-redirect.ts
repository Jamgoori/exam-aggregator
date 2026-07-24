// 로그인 후 돌아갈 경로("next")는 사용자 입력(쿼리 파라미터)이라 그대로 믿고 리다이렉트하면
// 오픈 리다이렉트 취약점이 된다 (예: ?next=https://evil.com 이나 ?next=//evil.com).
// 반드시 "이 사이트 안의 경로"로만 좁혀서 반환한다.
export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return "/";
  }
  return next;
}
