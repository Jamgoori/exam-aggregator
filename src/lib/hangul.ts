export const CONSONANTS = [
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

export function initialConsonant(text: string) {
  const code = text.trim().charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const choseongIndex = Math.floor(code / (21 * 28));
  return CHOSEONG_TO_BASE[choseongIndex] ?? null;
}
