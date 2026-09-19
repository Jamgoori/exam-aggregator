// 자유게시판 공용 규칙.
//
// 건의게시판(suggestions)과 다른 점만 적어둔다:
//   · 비밀글이 없다. 전부 공개라 목록·본문을 RLS 로 그냥 열어둔다(schema.sql).
//   · 본문이 평문이 아니라 **서식 있는 HTML** 이다. 저장 전에 반드시
//     sanitizeRichText 를 통과시킨 결과만 넣는다(rich-text.ts 머리말 참고).
//   · 댓글에 답글이 있다(1단계까지). 답글의 답글을 허용하지 않는 이유는
//     comments.ts 와 같다 — 깊이가 늘면 좁은 화면에서 들여쓰기가 감당이 안 된다.

import { profanityError } from "./profanity";
import { hasRichTextBody, richTextToPlain, RICH_TEXT_HTML_MAX } from "./rich-text";

export const BOARD_TITLE_MAX = 100;
export const BOARD_CONTENT_HTML_MAX = RICH_TEXT_HTML_MAX;
// 평문 기준 상한. HTML 상한과 따로 두는 이유는, 서식 태그가 많은 글은 평문이 짧아도
// HTML 이 금방 3만 자에 닿아서다 — 사용자에게 보여줄 "본문이 너무 길어요"의 기준은
// 눈에 보이는 글자 수여야 한다.
export const BOARD_CONTENT_TEXT_MAX = 10000;
export const BOARD_COMMENT_MAX = 1000;

// 게시판 말머리. 목록 상단 탭과 글쓰기 화면의 선택지가 이 배열 하나를 읽는다.
// slug 는 DB(board_posts.category)와 주소(?category=)에 그대로 쓰이므로 바꾸지 말 것.
export const BOARD_CATEGORIES = [
  { slug: "free", label: "자유", hint: "무슨 이야기든" },
  { slug: "question", label: "질문", hint: "공부하다 막힌 것" },
  { slug: "info", label: "정보", hint: "시험·일정·자료" },
  { slug: "review", label: "합격수기", hint: "직접 겪은 이야기" },
] as const;

export type BoardCategorySlug = (typeof BOARD_CATEGORIES)[number]["slug"];

export function isBoardCategory(value: unknown): value is BoardCategorySlug {
  return BOARD_CATEGORIES.some((c) => c.slug === value);
}

export function boardCategoryLabel(slug: string): string {
  return BOARD_CATEGORIES.find((c) => c.slug === slug)?.label ?? "자유";
}

export type BoardViewer = {
  userId: string | null;
  isAdmin: boolean;
};

export type BoardOwnership = {
  // null = 탈퇴한 회원의 글·댓글(설계서 §12-2 #17). viewer.userId 는 문자열이라 null 과 같을 수
  // 없어 아래 판정은 그대로 false — 관리자 삭제만 남는다.
  user_id: string | null;
};

// 수정은 글쓴이 본인만 — 관리자에게도 열지 않는다(건의게시판과 같은 이유: 남의 글이
// 내가 쓰지 않은 내용으로 바뀌어 있으면 안 된다).
export function canEditBoardPost(post: BoardOwnership, viewer: BoardViewer): boolean {
  return viewer.userId !== null && viewer.userId === post.user_id;
}

// 삭제는 본인 + 관리자(스팸·욕설 정리).
export function canDeleteBoardPost(post: BoardOwnership, viewer: BoardViewer): boolean {
  return viewer.isAdmin || canEditBoardPost(post, viewer);
}

export function canPinBoardPost(viewer: BoardViewer): boolean {
  return viewer.isAdmin;
}

export function canEditBoardComment(comment: BoardOwnership, viewer: BoardViewer): boolean {
  return viewer.userId !== null && viewer.userId === comment.user_id;
}

export function canDeleteBoardComment(comment: BoardOwnership, viewer: BoardViewer): boolean {
  return viewer.isAdmin || canEditBoardComment(comment, viewer);
}

export type BoardInputError = { error: string };
export type BoardPostInputOk = {
  title: string;
  category: BoardCategorySlug;
  // 새니타이즈까지 끝난 본문 HTML. 서버 액션은 이 값만 저장한다.
  contentHtml: string;
  // 목록 미리보기·검색용 평문(본문에서 뽑아낸 것).
  contentText: string;
};

// 제목·본문 검증. 본문은 **이미 새니타이즈된 HTML** 을 받는다 — 검증과 새니타이즈의
// 순서가 뒤집히면 "검사에는 통과했는데 저장된 건 다른 것"이 된다.
export function validateBoardPostInput(input: {
  title: string;
  category: string;
  sanitizedHtml: string;
}): BoardInputError | BoardPostInputOk {
  const title = String(input.title ?? "").trim();
  if (!title) return { error: "제목을 입력해주세요." };
  if (title.length > BOARD_TITLE_MAX)
    return { error: `제목은 ${BOARD_TITLE_MAX}자 이하로 입력해주세요.` };

  if (!isBoardCategory(input.category)) return { error: "말머리를 선택해주세요." };

  const contentHtml = String(input.sanitizedHtml ?? "");
  if (!hasRichTextBody(contentHtml)) return { error: "내용을 입력해주세요." };
  if (contentHtml.length > BOARD_CONTENT_HTML_MAX)
    return { error: "본문이 너무 깁니다. 글을 나눠서 올려주세요." };

  const contentText = richTextToPlain(contentHtml);
  if (contentText.length > BOARD_CONTENT_TEXT_MAX)
    return { error: `내용은 ${BOARD_CONTENT_TEXT_MAX}자 이하로 입력해주세요.` };

  // 비속어는 평문으로 검사한다 — HTML 그대로 검사하면 글자 사이에 <b></b> 하나만
  // 끼워 넣어도 그냥 빠져나간다.
  const profanity = profanityError(title) ?? profanityError(contentText);
  if (profanity) return { error: profanity };

  return { title, category: input.category, contentHtml, contentText };
}

export function validateBoardCommentContent(
  content: string,
): BoardInputError | { content: string } {
  const trimmed = String(content ?? "").trim();
  if (!trimmed) return { error: "댓글 내용을 입력해주세요." };
  if (trimmed.length > BOARD_COMMENT_MAX)
    return { error: `댓글은 ${BOARD_COMMENT_MAX}자 이하로 입력해주세요.` };
  const profanity = profanityError(trimmed);
  if (profanity) return { error: profanity };
  return { content: trimmed };
}

// 목록 카드에 깔 한 줄 미리보기. 줄바꿈을 공백으로 눌러 카드 높이를 고정한다.
export function boardPreviewText(contentText: string, limit = 120): string {
  const flat = String(contentText ?? "").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit)}…` : flat;
}

// 답글은 1단계까지만 — 답글에 달린 답글은 원 댓글에 달린 것으로 접어 올린다.
// (화면에서 깊이를 세지 않고 이 함수 하나로 부모를 정하면, 어떤 경로로 들어와도
//  트리가 두 단계를 넘지 않는다.)
export function resolveBoardCommentParent(target: {
  id: string;
  parent_id: string | null;
}): string {
  return target.parent_id ?? target.id;
}
