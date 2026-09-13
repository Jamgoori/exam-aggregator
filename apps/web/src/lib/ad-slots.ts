// 손으로 배치하는 광고 단위의 슬롯 ID.
//
// 게시자 ID 는 여기 두지 않는다 — 정본은 lib/adsense.ts 하나이고(로더·ads.txt·방침이
// 모두 그 값을 본다), 여기에 한 벌 더 두면 계정을 옮길 때 한쪽만 고치는 사고가 난다.
//
// 서버 전용 판정(lib/ads.ts)과 파일을 나눈 이유는 따로 있다. 이 값들은 <ins> 태그에
// 박혀 브라우저까지 가야 해서 클라이언트 컴포넌트가 import 하는데, 같은 파일에
// server-only 판정이 섞이면 그 import 하나로 빌드가 통째로 막힌다.
//
// 슬롯을 아직 안 만든 자리는 비워두면 그 자리만 조용히 빠진다 — 빈 회색 칸이 남지 않는다.

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
