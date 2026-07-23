"use client";

import { useEffect } from "react";

// App Router에서 loading.tsx 스켈레톤이 먼저 뜨는 페이지는, 브라우저/Next의
// 기본 해시 스크롤이 실제 콘텐츠가 붙기 전에 한 번 시도됐다가 대상이 없어
// 그냥 최상단에 머문다. 콘텐츠가 마운트된 뒤(이 클라이언트 컴포넌트의 effect
// 시점)엔 대상 요소가 DOM에 있으므로, 여기서 직접 해당 위치로 스크롤한다.
export function ScrollToHash() {
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ block: "start" });
  }, []);
  return null;
}
