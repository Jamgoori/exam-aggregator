const CONSONANTS = [
  "ㄱ",
  "ㄴ",
  "ㄷ",
  "ㄹ",
  "ㅁ",
  "ㅂ",
  "ㅅ",
  "ㅇ",
  "ㅈ",
  "ㅊ",
  "ㅋ",
  "ㅌ",
  "ㅍ",
  "ㅎ",
] as const;

// 유니코드 초성 순서(19개, 쌍자음 포함)를 기본 자음 14개로 매핑
const CHOSEONG_TO_BASE: Record<number, (typeof CONSONANTS)[number]> = {
  0: "ㄱ",
  1: "ㄱ", // ㄲ
  2: "ㄴ",
  3: "ㄷ",
  4: "ㄷ", // ㄸ
  5: "ㄹ",
  6: "ㅁ",
  7: "ㅂ",
  8: "ㅂ", // ㅃ
  9: "ㅅ",
  10: "ㅅ", // ㅆ
  11: "ㅇ",
  12: "ㅈ",
  13: "ㅈ", // ㅉ
  14: "ㅊ",
  15: "ㅋ",
  16: "ㅌ",
  17: "ㅍ",
  18: "ㅎ",
};

function choseongOf(char: string) {
  const code = char.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const choseongIndex = Math.floor(code / (21 * 28));
  return CHOSEONG_TO_BASE[choseongIndex] ?? null;
}

// 완성된 한글 음절만 초성으로 치환하고 그 외 문자(공백, 숫자, 영문 등)는 버린다.
// 예: "2024 국가직 9급 국어" -> "ㄱㄱㅈㄱㅇ"
export function toChoseongOnly(text: string) {
  let result = "";
  for (const ch of text) {
    const c = choseongOf(ch);
    if (c) result += c;
  }
  return result;
}

// 쿼리가 자음만으로 이루어져 있으면(예: "ㄱㅇ") 초성 검색으로 취급한다.
export function isChoseongQuery(text: string) {
  const stripped = text.replace(/\s/g, "");
  if (!stripped) return false;
  return [...stripped].every((ch) => (CONSONANTS as readonly string[]).includes(ch));
}

export function matchesChoseong(title: string, query: string) {
  const queryChoseong = query.replace(/\s/g, "");
  return toChoseongOnly(title).includes(queryChoseong);
}
