import { Linking } from "react-native";

// 게시판 본문 링크 등 사용자가 적은 주소를 여는 자리. http(s) 만 시스템 브라우저로 넘기고
// 그 외 스킴(mailto:·tel:·앱 스킴·내부 경로)은 열지 않는다 — 웹이 외부 링크에
// rel="noopener noreferrer nofollow" 를 강제하는 것과 같은 뜻으로, 본문 안의 주소가 다른
// 앱을 띄우거나 앱 안 화면으로 튀는 경로가 되지 않게 한다. 열 수 있는 주소인지는 호출부가
// 먼저 isOpenableLink 로 판정해 링크 모양(색·밑줄·누르기)을 줄지 정한다.
export function isOpenableLink(href: string | undefined | null): href is string {
  return typeof href === "string" && /^https?:\/\//i.test(href.trim());
}

export async function openExternalLink(href: string): Promise<void> {
  if (!isOpenableLink(href)) return;
  // 열기에 실패해도(브라우저 없음·차단) 화면이 죽을 일은 아니라 조용히 삼킨다.
  try {
    await Linking.openURL(href.trim());
  } catch {
    // 무시
  }
}
