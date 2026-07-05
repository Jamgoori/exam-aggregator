export const USERNAME_MIN = 4;
export const USERNAME_MAX = 20;
const USERNAME_PATTERN = /^[a-z0-9_]+$/;

// Supabase Auth는 이메일 또는 전화번호 형태의 식별자만 받기 때문에, 회원이 고른 아이디를
// 실제로는 존재하지 않는 도메인(RFC 2606이 이런 용도로 예약해 둔 TLD)의 이메일 형식으로
// 감싸서 저장한다. 이 주소로는 실제 메일이 발송되지 않으므로, Supabase 프로젝트의
// Authentication > Email 설정에서 "Confirm email"이 꺼져 있어야 가입 직후 로그인이 된다.
const AUTH_EMAIL_DOMAIN = "users.invalid";

export function usernameToAuthEmail(username: string): string {
  return `${username}@${AUTH_EMAIL_DOMAIN}`;
}

export function validateUsername(
  raw: string,
): { username: string; error: null } | { username: null; error: string } {
  const username = raw.trim().toLowerCase();

  if (username.length < USERNAME_MIN || username.length > USERNAME_MAX) {
    return {
      username: null,
      error: `아이디는 ${USERNAME_MIN}~${USERNAME_MAX}자로 입력해주세요.`,
    };
  }

  if (!USERNAME_PATTERN.test(username)) {
    return { username: null, error: "아이디는 영문 소문자, 숫자, _만 사용할 수 있어요." };
  }

  return { username, error: null };
}

// 마이페이지 등에서 "이메일" 자리에 보여줄 값. 아이디로 가입한 계정은 실제 이메일이
// 없으므로(가짜 주소만 있음) user_metadata에 저장해 둔 원래 아이디를 보여주고,
// 구글 로그인 계정은 그대로 실제 이메일을 보여준다.
export function accountLabel(user: {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}): string {
  const username = user.user_metadata?.username as string | undefined;
  return username ?? user.email ?? "";
}
