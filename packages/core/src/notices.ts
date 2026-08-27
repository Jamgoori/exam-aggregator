// 공지사항 게시판 공용 규칙.
//
// suggestions(건의게시판)와 달리 비밀글·답변 개념이 없다 — 운영자가 전체
// 이용자에게 알리는 글만 올라가고, 누구나 읽을 수 있다(RLS: public read).
// 원글 쓰기(작성/수정/삭제)는 운영자만 — DB에서는 is_admin() 정책이, 서버
// 액션에서는 여기 검증을 통과한 뒤 다시 한번 admin 여부를 확인한다(schema.sql,
// notices/actions.ts 참고).
//
// 댓글은 원글과 반대다 — 읽기는 원글처럼 누구나 가능하지만, 쓰기는 로그인
// 회원만 할 수 있다("본인" 여부를 특정해야 수정·삭제 권한을 줄 수 있어서다.
// suggestion_comments와 같은 이유).

import { profanityError } from "./profanity";

export const NOTICE_TITLE_MAX = 100;
export const NOTICE_CONTENT_MAX = 5000;
export const NOTICE_COMMENT_MAX = 1000;

export type NoticeInputError = { error: string };
export type NoticeInputOk = { title: string; content: string };

export function validateNoticeInput(input: {
  title: string;
  content: string;
}): NoticeInputError | NoticeInputOk {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();

  if (!title) return { error: "제목을 입력해주세요." };
  if (title.length > NOTICE_TITLE_MAX)
    return { error: `제목은 ${NOTICE_TITLE_MAX}자 이하로 입력해주세요.` };
  if (!content) return { error: "내용을 입력해주세요." };
  if (content.length > NOTICE_CONTENT_MAX)
    return { error: `내용은 ${NOTICE_CONTENT_MAX}자 이하로 입력해주세요.` };

  // 운영자만 쓸 수 있는 글이라도, 실수로 섞여 들어간 비속어까지 통과시킬 이유는 없다.
  const profanity = profanityError(title) ?? profanityError(content);
  if (profanity) return { error: profanity };

  return { title, content };
}

// ── 댓글 ─────────────────────────────────────────────────────────────────────
// 공지 하나 아래에 다는 평범한(중첩 없는) 댓글. 로그인 회원만 쓸 수 있어 답글
// 트리·깊이 제한 같은 comments.ts의 복잡함은 필요 없다(suggestion_comments와 같음).

export type NoticeViewer = {
  userId: string | null;
  isAdmin: boolean;
};

export type NoticeCommentOwnership = {
  user_id: string;
};

// 수정은 작성자 본인만 — 관리자에게도 열지 않는다(suggestion_comments와 같은 이유).
export function canEditNoticeComment(
  comment: NoticeCommentOwnership,
  viewer: NoticeViewer,
): boolean {
  return viewer.userId !== null && viewer.userId === comment.user_id;
}

// 삭제는 본인 + 관리자(스팸·욕설 정리).
export function canDeleteNoticeComment(
  comment: NoticeCommentOwnership,
  viewer: NoticeViewer,
): boolean {
  return viewer.isAdmin || canEditNoticeComment(comment, viewer);
}

export function validateNoticeCommentContent(
  content: string,
): NoticeInputError | { content: string } {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return { error: "댓글 내용을 입력해주세요." };
  if (trimmed.length > NOTICE_COMMENT_MAX)
    return { error: `댓글은 ${NOTICE_COMMENT_MAX}자 이하로 입력해주세요.` };
  const profanity = profanityError(trimmed);
  if (profanity) return { error: profanity };
  return { content: trimmed };
}
