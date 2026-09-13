import { Suspense } from "react";
import { shouldShowAds } from "@/lib/ads";
import { adSlotId, type AdPlacement } from "@/lib/ad-slots";
import { isAdsenseConfigured } from "@/lib/adsense";
import { AdSlot } from "@/components/ad-slot";

// 광고 자리. 쓰는 쪽은 <AdBanner placement="paperDetail" /> 한 줄이면 된다.
//
// ── 캐시(Cache Components)와 어떻게 공존하는가 ────────────────────────────────
// 광고를 띄울지는 쿠키를 봐야 아는 런타임 값이라, 정적 셸에 결과를 박으면 먼저 온
// 사람 기준으로 굳은 HTML 이 CDN 에 남아 모두에게 나간다. 그래서 판정은 Suspense
// 경계 뒤 비동기 컴포넌트에서만 한다(layout.tsx 의 헤더와 같은 구조) — 셸에는 아래
// fallback, 즉 "높이만 잡아 둔 빈 칸"이 들어간다.
//
// ── 왜 fallback 이 높이를 잡는가(CLS) ─────────────────────────────────────────
// 자리를 안 비워 두면 광고가 뒤늦게 도착하면서 아래 내용을 밀어낸다. 방문자
// 대부분(비로그인·무료 회원)은 결국 광고를 받으므로, 처음부터 그 높이를 비워 두면
// 밀림이 아예 없다. 광고를 빼주는 소수(결제·출석 보상·관리자)에게는 이 칸이 한 번
// 접히는데, 그쪽을 기준으로 잡으면 다수가 매번 밀리는 것과 맞바꾸는 셈이라 이렇게 뒀다.
// 검색 유입이 전부인 사이트라 코어 웹 바이탈(CLS)은 다수 기준으로 지켜야 한다.
//
// 몰입형 화면(CBT·복습 풀이)·결제·로그인에는 이 컴포넌트를 두지 말 것. 푸터나
// 헤더처럼 전역으로 달면 그 화면까지 따라 들어간다 — 자리마다 명시적으로 붙인다.

// 반응형 광고 단위가 실제로 차지하는 높이에 맞춘 예약 공간.
const RESERVED_HEIGHT = "min-h-[100px]";

export function AdBanner({ placement }: { placement: AdPlacement }) {
  // 게시자 ID·슬롯 ID 는 빌드 시점 환경변수라 셸에서 바로 판정해도 된다(사람마다
  // 다른 값이 아니다). 심사 전이거나 슬롯을 아직 안 만든 자리는 빈 칸도 남기지 않는다.
  if (!isAdsenseConfigured() || !adSlotId(placement)) return null;

  return (
    <Suspense
      fallback={<div className={`w-full ${RESERVED_HEIGHT}`} aria-hidden />}
    >
      <StreamedAd placement={placement} />
    </Suspense>
  );
}

async function StreamedAd({ placement }: { placement: AdPlacement }) {
  const slotId = adSlotId(placement);
  if (!slotId) return null;
  if (!(await shouldShowAds())) return null;

  return (
    // 인쇄에서는 뺀다 — 해설 인쇄(explanation-auto-print)가 종이 한 장을 광고로 쓴다.
    <div className={`w-full ${RESERVED_HEIGHT} print:hidden`}>
      <AdSlot slotId={slotId} />
    </div>
  );
}
