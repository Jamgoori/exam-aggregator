import { sanitizeNextPath } from "@gongmoa/core";

// 로그인 후 복귀 경로(설계서 §5 `next` 화이트리스트). core sanitizeNextPath 는 `/` 로
// 시작하는 모든 경로를 통과시키므로(`//`·`/\` 만 거른다) 앱에서는 미이식 경로
// (/admin/*, /api/*, /download/*)가 next 로 들어올 수 있다 → 아래 ✓ 경로 매처를 한 번 더
// 지나고, 실패하면 /papers 로 떨어뜨린다. gongmoa:// 커스텀 스킴 링크도 같은 매처를 지난다.
const ALLOWED: RegExp[] = [
  /^\/$/,
  /^\/papers(\/[^/]+(\/(cbt|explanations|pdf))?)?$/,
  /^\/exams(\/[^/]+)?$/,
  /^\/subjects(\/[^/]+(\/mix)?)?$/,
  /^\/mix$/,
  /^\/diagnosis$/,
  /^\/mypage$/,
  /^\/mypage\/(edit|payments|diagnosis)$/,
  /^\/mypage\/attempts\/[^/]+$/,
  /^\/mypage\/wrong-notes\/[^/]+(\/[^/]+|\/(mix|review)\/[^/]+)?$/,
  /^\/notifications$/,
  /^\/membership$/,
  /^\/board(\/new|\/[^/]+(\/edit)?)?$/,
  /^\/notices(\/[^/]+)?$/,
  /^\/suggestions(\/new|\/[^/]+(\/edit)?)?$/,
];

export const NEXT_FALLBACK = "/papers";

export function isAllowedAppPath(pathname: string): boolean {
  return ALLOWED.some((re) => re.test(pathname));
}

// 쿼리·해시는 경로 판정에서 뗀 뒤 그대로 돌려준다(`?tab=`·`#comment-` 유지).
export function resolveNextPath(raw: string | null | undefined): string {
  const sanitized = sanitizeNextPath(raw);
  const pathname = sanitized.split(/[?#]/, 1)[0] ?? "/";
  if (!isAllowedAppPath(pathname)) return NEXT_FALLBACK;
  return sanitized;
}

// 몰입 화면(헤더·푸터·탭·FAB 없음) — 웹 site-header-gate.tsx 정규식과 동일 + PDF 뷰어.
export function isImmersivePath(pathname: string): boolean {
  return (
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname) ||
    /^\/papers\/[^/]+\/pdf(\/|$)/.test(pathname) ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname)
  );
}
