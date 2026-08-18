// 댓글 본문 길이 제한. 서버 액션(실제 검증)과 클라이언트 폼(maxLength)이 같은 값을
// 써야 해서 한 곳에 모아둔다. 닉네임 제한은 회원가입과도 공유하므로 nickname.ts에 있다.
//
// 예전에 있던 비회원 댓글 비밀번호 제한(COMMENT_PW_MIN/MAX)은 뺐다 — 댓글이 회원
// 전용이 되어 새 비밀번호를 받는 자리가 없다. 이미 달려 있는 비회원 댓글을 비밀번호로
// 수정·삭제하는 길만 남아 있고(app/papers/actions.ts 의 authorizeComment), 그쪽은 저장된
// 해시와 비교만 하므로 길이 규칙이 필요 없다.
export const COMMENT_CONTENT_MAX = 2000;
