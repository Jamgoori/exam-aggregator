// 댓글·건의글 본문의 비속어/욕설 차단. 웹 서버 액션과 앱(Edge Function)이 같은 기준을
// 써야 해서 규칙을 여기 하나로 모은다.
//
// 닉네임 금칙어(nickname.ts 의 BANNED_SUBSTRINGS)와 목록을 합치지 않은 이유:
//  - 닉네임은 2~10자짜리 표시 이름이라 "닥쳐"가 들어가면 의도가 하나뿐이지만, 본문은
//    "위기가 닥쳐온다"처럼 멀쩡한 문장에도 같은 글자가 들어간다. 허용 오차가 달라
//    한 목록으로 묶으면 한쪽이 반드시 과하거나 모자라게 된다.
//  - 닉네임 목록은 DB 트리거(schema.sql)와 1:1로 맞춰져 있어(nickname.test.ts 가 대조)
//    여기서 단어를 늘리면 가입 화면까지 같이 조여진다.
// 대신 관리자 사칭 같은 닉네임 전용 항목은 여기 넣지 않는다 — 본문에 "관리자"라고
// 쓰는 건 정상이다.
//
// 완벽한 필터가 아니라 1차 방어선이다. 자모 분리(ㅅ ㅣ ㅂ ㅏ ㄹ)나 초성 사이 띄어쓰기
// 같은 우회까지 잡지는 않는다 — 그걸 잡으려고 공백을 지우고 검사하면 "응시 발표",
// "실시 발생" 같은 멀쩡한 말이 "시발"로 걸린다. 시험 사이트 특성상 그 오탐이 훨씬
// 잦아서, 공백은 단어 경계로 남겨두고 숫자·기호 삽입("시1발", "시*발")만 뚫는다.
export const PROFANITY_WORDS = [
  // 한국어
  "씨발",
  "시발",
  "씨빨",
  "시빨",
  "씨팔",
  "시팔",
  "씨바",
  "십새",
  "씹새",
  "씹창",
  "씹할",
  "씨부랄",
  "씨부럴",
  "시부랄",
  "시부럴",
  "병신",
  "븅신",
  "빙신",
  "등신",
  "머저리",
  "지랄",
  "지럴",
  "좆",
  "좃같",
  "좇같",
  "존나",
  "존내",
  "존만",
  "새끼",
  "쌔끼",
  "썅",
  "쌍놈",
  "쌍년",
  "개년",
  "개놈",
  "개소리",
  "개같",
  "개차반",
  "미친놈",
  "미친년",
  "니미",
  "느금마",
  "니애미",
  "애미없",
  "엠창",
  "창녀",
  "화냥년",
  "걸레같",
  "입닥쳐",
  "닥쳐라",
  "뒈져",
  "죽여버",
  // 초성 표기
  "ㅅㅂ",
  "ㅆㅂ",
  "ㅄ",
  "ㅂㅅ",
  "ㅈㄹ",
  "ㅆㅍ",
  // 영어
  "fuck",
  "shit",
  "bitch",
  "asshole",
  "bastard",
  "cunt",
  "whore",
  "nigger",
  "faggot",
  "dickhead",
];

// 금칙어를 부분 문자열로 품고 있지만 멀쩡한 말. 검사 전에 지워서 오탐을 막는다.
// ("논쟁의 시발점이 되었다" — 한국사·국어 문제지 댓글에 실제로 나온다)
export const PROFANITY_ALLOWED_PHRASES = [
  "시발점",
  "시발역",
  "시발자동차",
  "시발차",
];

export const PROFANITY_ERROR = "비속어·욕설이 포함되어 있어 등록할 수 없어요.";

// 소문자로 맞추고, 글자와 공백만 남긴다. 숫자·기호를 지우므로 "시1발", "시*발",
// "f.u.c.k" 같은 삽입 우회는 걸리고, 공백은 남기므로 "응시 발표"는 걸리지 않는다.
export function normalizeForProfanityCheck(raw: string): string {
  let text = String(raw ?? "")
    .toLowerCase()
    .normalize("NFC")
    .replace(/[^\p{L}\s]/gu, "")
    .replace(/\s+/gu, " ");

  for (const allowed of PROFANITY_ALLOWED_PHRASES) {
    text = text.split(allowed).join(" ");
  }
  return text;
}

// 걸린 단어를 돌려준다(없으면 null). 어떤 단어에 걸렸는지는 화면에 보여주지 않는다 —
// 어디를 고치면 통과하는지 알려주는 꼴이라 우회를 돕는다. 로그·테스트용이다.
export function findProfanity(text: string): string | null {
  const normalized = normalizeForProfanityCheck(text);
  if (!normalized) return null;
  return PROFANITY_WORDS.find((word) => normalized.includes(word)) ?? null;
}

export function containsProfanity(text: string): boolean {
  return findProfanity(text) !== null;
}

// 검증 함수들이 그대로 쓰기 좋은 모양: 문제가 있으면 안내 문구, 없으면 null.
export function profanityError(text: string): string | null {
  return containsProfanity(text) ? PROFANITY_ERROR : null;
}
