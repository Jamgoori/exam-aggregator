"use client";

import { usePathname } from "next/navigation";
import { SiteHeader } from "@/components/site-header";

// CBT 풀이 화면은 자체 헤더(뒤로가기/타이머/OMR)로 화면을 꽉 채워 쓰는 몰입형 레이아웃이라,
// 좁은 모바일 화면에서 전역 사이트 헤더까지 겹치면 세로 공간을 불필요하게 잡아먹는다.
// 데스크톱은 화면이 넉넉해 그대로 보여준다.
export function SiteHeaderGate({
  user,
}: {
  user: { nickname: string } | null | "pending";
}) {
  const pathname = usePathname();
  // CBT 풀이 화면과 섞어풀기/복습 풀이 화면 둘 다 자체 헤더로 화면을 꽉 채우는
  // 몰입형이라, 모바일에서 전역 헤더가 겹치면 OMR이 화면 밖으로 밀린다.
  const isImmersiveSolvePage =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");

  if (isImmersiveSolvePage) {
    return (
      <div className="hidden lg:block">
        <SiteHeader user={user} />
      </div>
    );
  }

  return <SiteHeader user={user} />;
}
