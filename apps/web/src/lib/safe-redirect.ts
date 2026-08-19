// 로그인 후 돌아갈 경로("next")는 사용자 입력(쿼리 파라미터)이라 그대로 믿고 리다이렉트하면
// 오픈 리다이렉트 취약점이 된다 (예: ?next=https://evil.com 이나 ?next=//evil.com).
// 반드시 "이 사이트 안의 경로"로만 좁혀서 반환한다.
//
// ── 탭·개행을 먼저 지우는 이유 ──────────────────────────────────────────────
// URL 파서(WHATWG)는 주소를 해석하기 **전에** 탭(\t)·개행(\n·\r)을 전부 제거한다.
// 브라우저의 Location 헤더 처리와 new URL() 이 똑같이 그렇게 한다. 그래서 아래 접두사
// 검사를 원본 문자열에 그대로 걸면 다음이 통과해 버린다:
//
//   "/\t/evil.com"  →  검사 통과("//" 로 시작하지 않으므로)
//                   →  new URL("/\t/evil.com", origin) 이 탭을 지워 "//evil.com" 이 되고,
//                      프로토콜 상대 URL 로 해석돼 https://evil.com 으로 나간다.
//
// 즉 "검사한 문자열"과 "실제로 파싱될 문자열"이 달라지는 것이 문제다. 먼저 지워서 둘을
// 같게 만든 뒤 검사하고, 반환도 지운 값으로 한다.
const URL_PARSER_STRIPPED = /[\t\n\r]/g;

export function sanitizeNextPath(next: string | null | undefined): string {
  if (!next) return "/";
  // 파서가 지울 문자를 먼저 지운다 — 이 값이 곧 파서가 보게 될 문자열이다.
  const path = next.replace(URL_PARSER_STRIPPED, "");
  if (!path.startsWith("/") || path.startsWith("//") || path.startsWith("/\\")) {
    return "/";
  }
  return path;
}
