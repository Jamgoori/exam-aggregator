// packages/core/src/profanity.ts 의 사본. Edge Function 은 Deno 런타임이라 모노레포
// 워크스페이스 패키지를 그대로 import 할 수 없어 여기 따로 둔다(_shared/cbt.ts 와 같은 이유).
// 두 목록이 갈리면 앱에서만 통과하는 구멍이 생기므로 packages/core/src/profanity.test.ts
// 가 이 파일과 대조한다 — 한쪽을 고치면 반드시 다른 쪽도 같이 고쳐야 한다.
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
