import { ADSENSE_CLIENT } from "@/lib/ad-slots";

// 애드센스가 요구하는 판매자 선언 파일. 도메인 루트(/ads.txt)에 있어야 하고, 없으면
// 애드센스 대시보드에 "수익 손실 위험" 경고가 뜨면서 일부 광고 수요가 빠진다.
//
// public/ads.txt 로 두지 않고 라우트로 만든 이유: 게시자 ID 를 환경변수 하나에서만
// 읽게 하려는 것이다. 파일로 두면 ID 가 코드 안에 한 번 더 적히고, 계정을 바꿀 때
// 한쪽만 고쳐도 아무도 눈치채지 못한다(광고는 계속 나오고 수익만 샌다).
//
// 마지막 필드는 구글 광고 시스템의 고정 식별자다 — 사이트마다 다른 값이 아니다.
const GOOGLE_TAG_ID = "f08c47fec0942fa0";

export function GET() {
  // 게시자 ID 가 없으면 선언할 판매자도 없다. 빈 파일을 200 으로 내주면 크롤러가
  // "이 사이트는 승인된 판매자가 없다"로 읽어, 광고가 붙은 뒤에도 수요가 빠진다.
  if (!ADSENSE_CLIENT) {
    return new Response("Not Found", { status: 404 });
  }

  // 파일 형식은 "google.com, pub-0000…, DIRECT, f08c…" 다. 환경변수는 <ins> 가 쓰는
  // "ca-pub-…" 형태라 접두사를 떼고 쓴다 — 붙인 채로 올리면 줄 전체가 무시된다.
  const publisherId = ADSENSE_CLIENT.replace(/^ca-/, "");

  return new Response(`google.com, ${publisherId}, DIRECT, ${GOOGLE_TAG_ID}\n`, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=86400",
    },
  });
}
