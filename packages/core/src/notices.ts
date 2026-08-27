// 공지사항 게시판 공용 규칙.
//
// suggestions(건의게시판)와 달리 비밀글·댓글·답변 같은 개념이 없다 — 운영자가
// 전체 이용자에게 알리는 글만 올라가고, 누구나 읽을 수 있다(RLS: public read).
// 쓰기(작성/수정/삭제)는 운영자만 — DB에서는 is_admin() 정책이, 서버 액션에서는
// 여기 검증을 통과한 뒤 다시 한번 admin 여부를 확인한다(schema.sql, notices/actions.ts 참고).

import { profanityError } from "./profanity";

export const NOTICE_TITLE_MAX = 100;
export const NOTICE_CONTENT_MAX = 5000;

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
