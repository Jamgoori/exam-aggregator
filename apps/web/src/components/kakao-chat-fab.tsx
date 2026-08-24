"use client";

import { usePathname } from "next/navigation";
import { KakaoIcon } from "@/components/kakao-icon";
import { KAKAO_OPEN_CHAT_URL } from "@/lib/business";

// 화면 왼쪽 아래에 붙어 다니는 카카오톡 오픈채팅 입구.
//
// 지금까지 문의 경로는 푸터의 메일 링크와 건의게시판뿐이라, 스크롤 중간에서
// 뭔가 물어보고 싶어진 사람은 맨 아래까지 내려가야 길을 찾을 수 있었다.
// 오픈채팅은 그 자리에서 바로 말을 걸 수 있는 유일한 창구라 항상 보이게 둔다.
//
// 자리는 오른쪽이 아니라 왼쪽 아래다 — 오른쪽 아래는 ReviewFab("복습 N")이 쓰는데,
// 그 버튼은 스크롤 위치와 오늘 복습량에 따라 나타났다 사라지므로 같은 쪽에 두면
// 서로 밀려 위치가 튄다.
export function KakaoChatFab() {
  const pathname = usePathname();

  // CBT/복습 풀이 화면은 몰입형이라 띄우지 않는다(판별 규칙은 site-header-gate.tsx와 같다).
  const immersive =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");
  if (immersive) return null;

  return (
    <a
      href={KAKAO_OPEN_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="공모아 카카오톡 오픈채팅방 열기"
      className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full bg-[#FEE500] p-3.5 text-sm font-bold text-black/90 shadow-lg shadow-black/10 transition-transform hover:scale-105 sm:py-3 sm:pl-4 sm:pr-5 print:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <KakaoIcon />
      {/* 좁은 화면에서는 아이콘만 — 노란 말풍선만으로도 뭔지 알아본다. */}
      <span className="hidden sm:inline">오픈채팅</span>
    </a>
  );
}
