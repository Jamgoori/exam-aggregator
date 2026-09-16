import { sanitizeNextPath } from "@gongmoa/core";

// 로그인 후 복귀 경로(설계서 §5 `next` 화이트리스트). core sanitizeNextPath 는 `/` 로
// 시작하는 모든 경로를 통과시키므로(`//`·`/\` 만 거른다) 앱에서는 미이식 경로
// (/admin/*, /api/*, /download/*)가 next 로 들어올 수 있다 → 아래 ✓ 경로 매처를 한 번 더
// 지나고, 실패하면 /papers 로 떨어뜨린다. gongmoa:// 커스텀 스킴 링크도 같은 매처를 지난다.
//
// **이 목록은 "지금 앱에 있는 화면"만 담는다.** 아직 안 만든 웹 경로를 미리 넣어 두면 로그인
// 직후 복귀(`/login?next=…`)·딥링크가 곧장 `+not-found` 로 떨어져, "로그인은 됐는데 화면이
// 없다"가 된다 — 매처에서 빠지면 대신 `/papers` 로 떨어지니 훨씬 낫다. 그래서 화면이 생기는
// 단계에 맞춰 아래에 한 줄씩 되돌려 넣는다:
//   - Phase 3(§12 "믹스"): `/mix`, `/subjects/[slug]/mix`
//   - Phase 4(§12 "계정·알림·진단"): `/notifications`, `/mypage/diagnosis`
//   - Phase 5(§12 "커뮤니티"): `/board*`, `/notices*`, `/suggestions*`
// (AASA·assetlinks 의 `paths` 도 같은 기준으로 화면이 생길 때 함께 연다 — §5 딥링크 문단.)
const ALLOWED: RegExp[] = [
  /^\/$/,
  /^\/papers(\/[^/]+(\/(cbt|explanations|pdf))?)?$/,
  /^\/exams(\/[^/]+)?$/,
  /^\/subjects(\/[^/]+)?$/,
  /^\/diagnosis$/,
  /^\/mypage$/,
  /^\/mypage\/(edit|payments)$/,
  /^\/mypage\/attempts\/[^/]+$/,
  /^\/mypage\/wrong-notes\/[^/]+(\/[^/]+|\/(mix|review)\/[^/]+)?$/,
  /^\/membership$/,
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
