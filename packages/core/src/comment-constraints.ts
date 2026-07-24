// 댓글 본문/비회원 비밀번호 길이 제한. 서버 액션(실제 검증)과 클라이언트 폼
// (maxLength, placeholder 안내)이 같은 값을 써야 해서 한 곳에 모아둔다.
// 닉네임 제한은 회원가입과도 공유하므로 lib/nickname.ts에 있다.
export const COMMENT_CONTENT_MAX = 2000;
export const COMMENT_PW_MIN = 4;
export const COMMENT_PW_MAX = 16;
