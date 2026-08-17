// 건의게시판(=1:1 건의) 공용 규칙.
//
// "비밀글"이 이 게시판의 핵심이라, 누가 무엇을 볼 수 있는지 판단하는 함수를 화면
// (목록/상세)과 서버 액션이 같이 쓴다. 판단이 두 곳에 따로 적히면 "목록에는 제목이
// 보이는데 상세는 막힌다" 같은 어긋남이 생기고, 반대로 어긋나면 남의 비밀글이 샌다.

export const SUGGESTION_TITLE_MAX = 100;
export const SUGGESTION_CONTENT_MAX = 2000;
export const SUGGESTION_ANSWER_MAX = 2000;

// 목록에서 남의 비밀글 자리에 제목 대신 넣는 문구. 제목까지 가리는 이유는,
// 사람들이 제목에 "○○○입니다, 결제 오류 문의" 처럼 개인정보를 그대로 적기 때문이다.
export const SECRET_TITLE_PLACEHOLDER = "비밀글입니다.";

export type SuggestionViewer = {
  userId: string | null;
  isAdmin: boolean;
};

export type SuggestionOwnership = {
  user_id: string;
  is_secret: boolean;
};

// 본문을 볼 수 있는가. 공개글은 누구나, 비밀글은 글쓴이 본인과 관리자만.
export function canReadSuggestion(
  suggestion: SuggestionOwnership,
  viewer: SuggestionViewer,
): boolean {
  if (!suggestion.is_secret) return true;
  if (viewer.isAdmin) return true;
  return viewer.userId !== null && viewer.userId === suggestion.user_id;
}

// 수정은 글쓴이 본인만 — 관리자에게도 열지 않는다. 남이 낸 건의의 내용을 관리자가
// 고칠 수 있으면 "내가 쓴 글이 다르게 바뀌어 있다"가 가능해진다(답변은 별도 필드다).
export function canEditSuggestion(
  suggestion: SuggestionOwnership,
  viewer: SuggestionViewer,
): boolean {
  return viewer.userId !== null && viewer.userId === suggestion.user_id;
}

// 삭제는 본인 + 관리자(스팸·욕설 정리).
export function canDeleteSuggestion(
  suggestion: SuggestionOwnership,
  viewer: SuggestionViewer,
): boolean {
  return viewer.isAdmin || canEditSuggestion(suggestion, viewer);
}

// 목록에 실제로 그릴 제목. 볼 수 없는 비밀글이면 문구로 바꿔치기한다.
export function suggestionListTitle(
  suggestion: SuggestionOwnership & { title: string },
  viewer: SuggestionViewer,
): string {
  return canReadSuggestion(suggestion, viewer)
    ? suggestion.title
    : SECRET_TITLE_PLACEHOLDER;
}

export type SuggestionInputError = { error: string };
export type SuggestionInputOk = { title: string; content: string };

// 제목·내용 검증. 서버 액션이 최종 관문이고, 폼도 같은 규칙으로 미리 걸러준다.
export function validateSuggestionInput(input: {
  title: string;
  content: string;
}): SuggestionInputError | SuggestionInputOk {
  const title = String(input.title ?? "").trim();
  const content = String(input.content ?? "").trim();

  if (!title) return { error: "제목을 입력해주세요." };
  if (title.length > SUGGESTION_TITLE_MAX)
    return { error: `제목은 ${SUGGESTION_TITLE_MAX}자 이하로 입력해주세요.` };
  if (!content) return { error: "내용을 입력해주세요." };
  if (content.length > SUGGESTION_CONTENT_MAX)
    return { error: `내용은 ${SUGGESTION_CONTENT_MAX}자 이하로 입력해주세요.` };

  return { title, content };
}

// 관리자 답변 검증. 빈 답변은 "답변 완료" 배지만 붙고 내용이 없는 글이 되므로 막는다.
export function validateSuggestionAnswer(answer: string): SuggestionInputError | { answer: string } {
  const trimmed = String(answer ?? "").trim();
  if (!trimmed) return { error: "답변 내용을 입력해주세요." };
  if (trimmed.length > SUGGESTION_ANSWER_MAX)
    return { error: `답변은 ${SUGGESTION_ANSWER_MAX}자 이하로 입력해주세요.` };
  return { answer: trimmed };
}
