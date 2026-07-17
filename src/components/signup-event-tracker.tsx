"use client";

import { useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/ga-events";

// 닉네임 온보딩(=신규 가입 완료)을 마치면 updateNickname이 목적지 URL에
// ?signup=1을 붙여 보낸다. 가입 완료는 서버 액션 안에서 일어나 gtag를 직접
// 호출할 수 없으므로, 이 컴포넌트가 그 표식을 보고 GA4 sign_up 이벤트를 한 번
// 쏜 뒤 URL에서 파라미터를 지운다(새로고침 시 중복 전송 방지).
export function SignupEventTracker() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (searchParams.get("signup") !== "1") return;
    trackEvent("sign_up", { method: "social" });
    const rest = new URLSearchParams(searchParams);
    rest.delete("signup");
    const query = rest.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, {
      scroll: false,
    });
  }, [searchParams, pathname, router]);

  return null;
}
