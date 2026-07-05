// 닉네임 정책을 한 곳에 모아둔다. 가입 시, 마이페이지 수정 시, 댓글 작성 시(회원/비회원)
// 모두 같은 기준을 써야 예를 들어 가입할 때는 길게 넣어놓고 나중에 댓글에서만 잘리는 식의
// 불일치가 안 생긴다. 상한(10자)은 comments 테이블의 comments_nickname_len 제약과 동일하게 맞춰서,
// 회원 닉네임이 그대로 댓글에 들어가도 별도로 자를 필요가 없게 한다.
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

// 개행/탭 등 제어문자가 섞이면 헤더·댓글 목록 등 여러 화면의 레이아웃이 깨질 수 있어 막는다.
// (유니코드 "Cc"=제어문자 카테고리를 그대로 검사 — 리터럴 제어 바이트를 소스에 직접 넣지 않기 위함)
const CONTROL_CHARS = /\p{Cc}/u;

export function validateNickname(
  raw: string,
): { nickname: string; error: null } | { nickname: null; error: string } {
  const nickname = raw.trim().replace(/\s+/g, " ");

  if (nickname.length < NICKNAME_MIN || nickname.length > NICKNAME_MAX) {
    return {
      nickname: null,
      error: `닉네임은 ${NICKNAME_MIN}~${NICKNAME_MAX}자로 입력해주세요.`,
    };
  }

  if (CONTROL_CHARS.test(nickname)) {
    return { nickname: null, error: "닉네임에 사용할 수 없는 문자가 포함되어 있어요." };
  }

  return { nickname, error: null };
}
