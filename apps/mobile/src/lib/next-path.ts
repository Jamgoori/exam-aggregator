import { sanitizeNextPath } from "@gongmoa/core";

// 로그인 후 복귀 경로(설계서 §5 `next` 화이트리스트). core sanitizeNextPath 는 `/` 로
// 시작하는 모든 경로를 통과시키므로(`//`·`/\` 만 거른다) 앱에서는 미이식 경로
// (/admin/*, /api/*, /download/*)가 next 로 들어올 수 있다 → 아래 ✓ 경로 매처를 한 번 더
// 지나고, 실패하면 /papers 로 떨어뜨린다. gongmoa:// 커스텀 스킴 링크도 같은 매처를 지난다.
//
// **이 목록은 "지금 앱에 있는 화면"만 담는다.** 아직 안 만든 웹 경로를 미리 넣어 두면 로그인
// 직후 복귀(`/login?next=…`)·딥링크가 곧장 `+not-found` 로 떨어져, "로그인은 됐는데 화면이
// 없다"가 된다 — 매처에서 빠지면 대신 `/papers` 로 떨어지니 훨씬 낫다. 그래서 화면이 생기는
// 단계에 맞춰 아래에 한 줄씩 되돌려 넣는다(Phase 3 에서 `/mix`·`/subjects/[slug]/mix`,
// Phase 4 에서 `/notifications`·`/mypage/diagnosis`, Phase 5 1라운드에서 `/board*`·`/notices*`,
// 2라운드에서 `/suggestions*` 가 들어왔다 — 이제 설계서 §5 의 ✓ 경로는 전부 여기 있다).
//
// `/notices/new`·`/notices/[id]/edit` 는 일부러 빠져 있다 — 관리자 전용 화면이라 앱에 없고(§5),
// AASA 의 EXCLUDED 에도 같은 두 줄이 서 있다. 정규식의 `(?!new$)` 가 그 자리다.
//
// 알림 목록(§6.7 #15)도 이 매처를 쓴다: 알림의 `link` 는 웹 경로다(게시판·건의글). 앱에 없는
// 화면을 가리키는 링크가 오면 그 줄을 누를 때 여기서 걸러 `+not-found` 대신 그 자리에 머문다
// (components/notifications/open-notification.ts) — 지금은 두 종류 다 열린다.
//
// **유니버설 링크도 같은 목록이다** — 화면이 생기면 세 곳을 함께 연다(§5 딥링크 문단):
// 이 파일 · 웹 `apps/web/src/app/.well-known/apple-app-site-association/route.ts` 의
// `ALLOWED_PATHS`(iOS) · `app.json` 의 `android.intentFilters` pathPrefix(Android).
// 여기만 열면 웹 링크가 브라우저로 새고, 저 둘만 열면 앱이 열렸다가 `+not-found` 로 떨어진다.
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
  /^\/membership$/,
  /^\/notifications$/,
  // 자유게시판: 목록·글쓰기·상세·수정 — 웹 주소 모양 그대로(`/board/new` 도 `[^/]+` 에 걸리므로 따로
  // 적지 않는다; `/board/new/edit` 같은 주소는 웹에도 없다).
  /^\/board(\/[^/]+(\/edit)?)?$/,
  // 공지사항: 목록·상세만(`/notices/new`·`/notices/*/edit` 는 관리자 전용 — 위 머리말).
  /^\/notices(\/(?!new$)[^/]+)?$/,
  // 건의게시판: 목록·건의하기·상세·수정 — 게시판과 같은 모양(`/suggestions/new` 도 `[^/]+` 에 걸린다).
  /^\/suggestions(\/[^/]+(\/edit)?)?$/,
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
