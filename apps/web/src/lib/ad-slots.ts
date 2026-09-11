// 구글 애드센스 식별자들 — 게시자 ID 와 자리별 광고 단위 슬롯 ID.
//
// 서버 전용 판정(lib/ads.ts)과 일부러 파일을 나눴다. 이 값들은 <ins> 태그에 그대로
// 박혀 브라우저까지 가야 하므로 클라이언트 컴포넌트가 import 하는데, 같은 파일에
// server-only 판정이 섞여 있으면 그 import 하나로 빌드가 통째로 막힌다.
//
// 값이 비어 있으면 광고 자리 자체가 렌더되지 않는다(GA·Clarity 와 같은 방식).
// 게시자 ID 만 넣고 슬롯을 안 만든 상태로 배포해도 빈 회색 칸이 생기지 않는다.

// "ca-pub-0000000000000000". 애드센스 > 계정 > 설정에서 확인한다.
export const ADSENSE_CLIENT = process.env.NEXT_PUBLIC_ADSENSE_CLIENT ?? "";

// 광고를 두는 자리. 자리마다 애드센스에서 광고 단위를 따로 만들어야 수익 보고서에서
// "어느 화면이 버는지"가 갈려 보인다 — 하나를 세 곳에 돌려 쓰면 그 구분이 사라진다.
export type AdPlacement = "home" | "papersList" | "paperDetail";

const SLOT_IDS: Record<AdPlacement, string> = {
  home: process.env.NEXT_PUBLIC_ADSENSE_SLOT_HOME ?? "",
  papersList: process.env.NEXT_PUBLIC_ADSENSE_SLOT_PAPERS ?? "",
  paperDetail: process.env.NEXT_PUBLIC_ADSENSE_SLOT_PAPER ?? "",
};

export function adSlotId(placement: AdPlacement): string | null {
  return SLOT_IDS[placement] || null;
}
