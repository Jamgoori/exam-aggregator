"use client";

import { sendGAEvent } from "@next/third-parties/google";

// GA4 이벤트 전송 헬퍼. 광고 성과 측정(전환 이벤트)용으로, 배포 환경에 GA_ID가
// 없으면 조용히 무시된다. 이벤트 이름은 GA4 추천 이벤트 명세를 따른다
// (sign_up 등) — 임의 이름보다 광고 플랫폼 연동이 매끄럽다.
export function trackEvent(
  name: string,
  params?: Record<string, string | number>,
) {
  if (!process.env.NEXT_PUBLIC_GA_ID) return;
  try {
    sendGAEvent("event", name, params ?? {});
  } catch {
    // 광고 차단기 등으로 dataLayer가 없어도 서비스 동작에는 영향 없어야 한다.
  }
}
