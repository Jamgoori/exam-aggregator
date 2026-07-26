import * as WebBrowser from "expo-web-browser";

// 약관·개인정보처리방침은 웹(apps/web/src/app/terms, /privacy)이 원본이다. 앱에 텍스트를
// 복사하면 웹만 고쳤을 때 법적 문서가 두 벌로 갈리므로, 앱은 인앱 브라우저로 웹 문서를
// 연다. 그래서 배포 도메인이 반드시 .env 에 있어야 한다(없으면 심사에서 막힌다).
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, "");

export type LegalDoc = "terms" | "privacy";

const PATHS: Record<LegalDoc, string> = {
  terms: "/terms",
  privacy: "/privacy",
};

export const LEGAL_LABELS: Record<LegalDoc, string> = {
  terms: "이용약관",
  privacy: "개인정보처리방침",
};

export function legalUrl(doc: LegalDoc): string | null {
  return WEB_URL ? `${WEB_URL}${PATHS[doc]}` : null;
}

export async function openLegal(doc: LegalDoc): Promise<void> {
  const url = legalUrl(doc);
  if (!url) {
    throw new Error(
      "EXPO_PUBLIC_WEB_URL 이 .env 에 없어 문서를 열 수 없어요. (.env.example 참고)",
    );
  }
  await WebBrowser.openBrowserAsync(url);
}
