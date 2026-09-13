// 구글 애드센스 게시자 ID 를 두는 단 한 곳. 로더 스크립트(app/layout.tsx 의 <head>)와
// /ads.txt(app/ads.txt/route.ts), 개인정보처리방침의 광고 고지가 모두 이 값을 본다.
//
// **왜 한 곳에 모았나 — 같은 ID 가 두 형태로 쓰인다.**
//   로더 스크립트: ...adsbygoogle.js?client=ca-pub-0000000000000000   (ca- 붙음)
//   ads.txt:       google.com, pub-0000000000000000, DIRECT, f08c47fec0942fa0  (ca- 없음)
// 애드센스 화면도 "코드 가져오기"에서는 ca-pub-, ads.txt 안내에서는 pub- 로 보여준다.
// 두 곳에 손으로 옮겨 적으면 한쪽에 ca- 가 붙거나 빠지는 사고가 나는데, 그래도 화면에는
// 아무 표시가 없다 — 광고가 안 나오거나(잘못된 client) 애드센스가 "ads.txt 파일에 게시자
// ID 가 없다"고만 알려준다. 그래서 숫자만 한 번 받아 두 형태를 여기서 만들어 쓴다.
//
// **왜 환경변수가 아니라 코드 상수인가.** 게시자 ID 는 HTML 에 그대로 드러나는 공개
// 문자열이라 숨길 이유가 없고, 값이 비면 광고가 조용히 멈추는 데다 /ads.txt 까지 404 가
// 된다(애드센스는 ads.txt 가 없으면 "수익 손실 위험" 경고를 띄운다). 환경변수 하나가
// 빠져서 그렇게 되는 걸 막으려고 layout.tsx 의 네이버 소유확인 값과 같은 방식을 쓴다 —
// 아래 상수가 정본, env(NEXT_PUBLIC_ADSENSE_CLIENT)는 계정을 옮길 때의 탈출구.
//
// 값이 비어 있으면(승인 전·계정 없음) 로더 스크립트도 /ads.txt 도 방침의 광고 고지도
// 전부 붙지 않는다. 광고를 하지 않는 상태에서 "광고를 한다"고 고지하는 쪽이 더 문제라
// 결제(isTossConfigured)와 같은 판단을 따른다.
const PUBLISHER_ID = "";

// "ca-pub-1234567890123456" · "pub-1234567890123456" · "1234567890123456" 을 모두 받아
// 숫자만 남긴다. 애드센스 화면에서 복사해 오는 형태가 자리마다 다르기 때문이다.
// 형식이 어긋나면 null — 잘못된 client 로 스크립트를 붙여 봐야 광고는 안 나오고,
// 엉뚱한 ads.txt 한 줄은 애드센스에 "확인되지 않은 게시자"로 남는다.
export function parsePublisherId(raw: string | null | undefined): string | null {
  const digits = (raw ?? "")
    .trim()
    .replace(/^ca-/i, "")
    .replace(/^pub-/i, "");
  return /^[0-9]{10,20}$/.test(digits) ? digits : null;
}

const PUBLISHER_DIGITS = parsePublisherId(
  process.env.NEXT_PUBLIC_ADSENSE_CLIENT || PUBLISHER_ID,
);

// 스크립트 태그가 쓰는 형태(ca-pub-…). 설정 전에는 null.
export const ADSENSE_CLIENT = PUBLISHER_DIGITS ? `ca-pub-${PUBLISHER_DIGITS}` : null;

export function isAdsenseConfigured(): boolean {
  return ADSENSE_CLIENT !== null;
}

// 광고 로더 주소. crossorigin="anonymous" 까지 붙여야 애드센스가 요구하는 형태가 된다
// (layout.tsx 참고).
export function adsenseLoaderSrc(): string | null {
  return ADSENSE_CLIENT
    ? `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`
    : null;
}

// ads.txt 본문. 형식은 IAB 표준이고 네 번째 칸은 구글의 인증 기관 ID(TAG-ID)로
// **모든 애드센스 게시자가 같은 값을 쓴다** — 우리 계정 값이 아니므로 바꾸지 말 것.
//   <광고 시스템 도메인>, <게시자 ID>, <DIRECT|RESELLER>, <인증 기관 ID>
// 애드센스가 직접 거래이므로 DIRECT.
export const GOOGLE_ADS_TXT_CERTIFICATION_AUTHORITY_ID = "f08c47fec0942fa0";

export function adsTxtBody(): string | null {
  if (!PUBLISHER_DIGITS) return null;
  return [
    "# 이 파일은 apps/web/src/app/ads.txt/route.ts 가 만든다 (게시자 ID: lib/adsense.ts).",
    "# 다른 광고 네트워크를 붙이면 그 회사가 알려주는 줄을 같은 형식으로 추가한다.",
    `google.com, pub-${PUBLISHER_DIGITS}, DIRECT, ${GOOGLE_ADS_TXT_CERTIFICATION_AUTHORITY_ID}`,
    "",
  ].join("\n");
}
