import { loginRedirectHref } from "../mypage/require-login";

// 게스트가 글쓰기로 들어올 때의 로그인 안내 — 웹 app/board/new/page.tsx 의 redirect 문구 그대로.
// 목록의 "글쓰기" 버튼(app/board/index.tsx)과 `/board/new` 화면(useRequireLogin) 두 입구가 같은 문장을
// 써야 어느 쪽으로 들어와도 로그인 화면이 같은 말을 한다.
export const BOARD_NEW_LOGIN_MESSAGE = "로그인 후 글을 쓸 수 있어요";

export function boardNewLoginHref() {
  return loginRedirectHref("/board/new", BOARD_NEW_LOGIN_MESSAGE);
}
