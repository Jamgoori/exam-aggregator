// 닉네임 정책을 한 곳에 모아둔다. 가입 시, 마이페이지 수정 시, 댓글 작성 시(회원/비회원)
// 모두 같은 기준을 써야 예를 들어 가입할 때는 길게 넣어놓고 나중에 댓글에서만 잘리는 식의
// 불일치가 안 생긴다. 상한(10자)은 comments 테이블의 comments_nickname_len 제약과 동일하게 맞춰서,
// 회원 닉네임이 그대로 댓글에 들어가도 별도로 자를 필요가 없게 한다.
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

// 개행/탭 등 제어문자가 섞이면 헤더·댓글 목록 등 여러 화면의 레이아웃이 깨질 수 있어 막는다.
// (유니코드 "Cc"=제어문자 카테고리를 그대로 검사 — 리터럴 제어 바이트를 소스에 직접 넣지 않기 위함)
const CONTROL_CHARS = /\p{Cc}/u;

// 관리자 사칭(운영진 행세로 댓글에서 신뢰를 얻는 등)과 명백한 비속어를 막기 위한
// 부분 문자열 차단 목록. 완벽한 욕설 필터는 아니고(우회 표기까지 잡아내진 못함),
// 흔한 사례를 걸러내는 1차 방어선이다. 공백/구두점을 지우고 소문자로 맞춘 뒤 검사해서
// "a d m i n"처럼 문자 사이를 띄우는 흔한 우회는 걸러낸다.
const BANNED_SUBSTRINGS = [
  // 운영진/관리자 사칭
  "admin",
  "administrator",
  "관리자",
  "운영자",
  "운영진",
  "매니저",
  "manager",
  "moderator",
  "모더레이터",
  "system",
  "시스템",
  "root",
  "공지사항",
  "notice",
  "staff",
  "스태프",
  "고객센터",
  "공모아",
  // 비속어 (일부, 완전하지 않음)
  "씨발",
  "시발",
  "병신",
  "지랄",
  "좆",
  "개새끼",
  "새끼",
  "썅",
  "닥쳐",
  "fuck",
  "shit",
  "bitch",
  "asshole",
];

// 문자 사이에 공백/숫자/기호를 끼워 넣는 흔한 우회("a d m i n", "씨1발")를 막기 위해
// 글자(유니코드 "L"=letter 카테고리)만 남기고 나머지는 전부 지운 뒤 검사한다.
function normalizeForBanCheck(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}]/gu, "");
}

function containsBannedWord(nickname: string): boolean {
  const normalized = normalizeForBanCheck(nickname);
  return BANNED_SUBSTRINGS.some((word) => normalized.includes(word));
}

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

  if (containsBannedWord(nickname)) {
    return { nickname: null, error: "사용할 수 없는 닉네임이에요." };
  }

  return { nickname, error: null };
}
