"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";
import { ADSENSE_CLIENT } from "@/lib/ad-slots";

// 애드센스 스크립트가 읽어가는 전역 큐. 스크립트가 오기 전에 push 된 것들이 여기
// 쌓였다가 로드 시점에 한꺼번에 처리된다.
declare global {
  interface Window {
    adsbygoogle?: Record<string, unknown>[];
  }
}

// 광고 한 칸. "보여줄지 말지"는 이미 서버에서 끝났고(lib/ads.ts), 여기는 그리기만 한다.
//
// 애드센스는 <ins> 를 DOM 에 올린 **뒤에** adsbygoogle 큐에 한 번 push 해야 그 자리를
// 채운다. 스크립트가 아직 안 왔어도 괜찮다 — push 된 것들은 배열에 쌓여 있다가
// 스크립트가 로드되면서 한꺼번에 처리된다.
//
// 높이는 부모(ad-banner.tsx)가 잡아 준다. 여기서 다시 잡으면 두 곳이 서로 다른 값을
// 갖게 되어, 광고가 도착하는 순간 화면이 그만큼 덜컹인다.
export function AdSlot({ slotId }: { slotId: string }) {
  const pushed = useRef(false);

  useEffect(() => {
    // 같은 <ins> 에 두 번 push 하면 애드센스가 "이미 광고가 있다"며 그 자리를 통째로
    // 거른다. 개발 모드의 이중 마운트에서 실제로 일어난다.
    if (pushed.current) return;
    pushed.current = true;
    try {
      (window.adsbygoogle = window.adsbygoogle ?? []).push({});
    } catch {
      // 광고 차단기·네트워크 실패. 광고가 안 뜬다고 페이지가 깨질 이유는 없다.
    }
  }, []);

  return (
    <>
      {/* id 가 같으면 next/script 가 한 번만 싣는다 — 한 화면에 광고 자리가 둘이어도
          라이브러리는 하나다. */}
      <Script
        id="adsbygoogle-js"
        strategy="afterInteractive"
        crossOrigin="anonymous"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      />
      <ins
        className="adsbygoogle block w-full"
        style={{ display: "block" }}
        data-ad-client={ADSENSE_CLIENT}
        data-ad-slot={slotId}
        data-ad-format="auto"
        data-full-width-responsive="true"
      />
    </>
  );
}
