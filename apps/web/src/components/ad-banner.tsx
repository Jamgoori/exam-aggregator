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

// ── 화면 오른쪽 세로 레일 ────────────────────────────────────────────────────
// 본문 옆에 자리가 남는 넓은 화면에서만 보인다. 보일지 말지는 CSS 미디어 쿼리가
// 정하고(globals.css 의 .ad-rail — 폭과 높이를 함께 본다), 여기서는 자리만 만든다.
// 자바스크립트로 창 크기를 재서 판정하지 않는 이유: 서버가 보낸 HTML 과 첫 렌더가
// 달라져 하이드레이션이 어긋나고, 창을 줄일 때마다 광고가 붙었다 떨어졌다 한다.
//
// position: fixed 라 문서 흐름에서 빠져 있다 — 그래서 높이를 예약할 것도, 늦게 와서
// 본문을 밀 일도 없다(아래 fallback 이 null 인 이유).
//
// 왼쪽이 아니라 오른쪽인 건 채팅 버튼이 왼쪽 아래에 있어서다. 옮기고 싶으면 아래
// right-4 를 left-4 로 바꾸면 되는데, 그때는 채팅 버튼과의 세로 간격을 다시 볼 것.
const RAIL_WIDTH = 160;
const RAIL_HEIGHT = 600;

// 자리마다 본문 폭이 달라서 "레일이 들어갈 만큼 넓은 화면"의 기준이 다르다.
const RAIL_BREAKPOINT: Record<"papersSide" | "paperDetailSide", string> = {
  // 기출문제 목록은 본문이 max-w-7xl 이라 더 넓은 화면이어야 자리가 남는다.
  papersSide: "ad-rail-7xl",
  // 문제지 상세는 max-w-5xl.
  paperDetailSide: "ad-rail-5xl",
};

export function AdSideRail({
  placement,
}: {
  placement: "papersSide" | "paperDetailSide";
}) {
  if (!isAdsenseConfigured() || !adSlotId(placement)) return null;

  return (
    <Suspense fallback={null}>
      <StreamedSideRail placement={placement} />
    </Suspense>
  );
}

async function StreamedSideRail({
  placement,
}: {
  placement: "papersSide" | "paperDetailSide";
}) {
  const slotId = adSlotId(placement);
  if (!slotId) return null;
  if (!(await shouldShowAds())) return null;

  return (
    <div
      className={`ad-rail ${RAIL_BREAKPOINT[placement]} fixed right-4 top-24 z-30 print:hidden`}
      // 화면 아래 고정 버튼(z-40)보다 뒤에 둔다. 혹시 겹치는 화면이 있어도 버튼이
      // 광고 위로 올라오게 해서, 누르려던 버튼 대신 광고가 눌리는 일을 막는다.
    >
      <AdSlot slotId={slotId} width={RAIL_WIDTH} height={RAIL_HEIGHT} />
    </div>
  );
}
