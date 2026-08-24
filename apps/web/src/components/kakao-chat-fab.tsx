"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { KakaoIcon } from "@/components/kakao-icon";
import { KAKAO_OPEN_CHAT_URL } from "@/lib/business";

// 홈 왼쪽 아래에 붙는 카카오톡 오픈채팅 입구.
//
// 지금까지 문의 경로는 푸터의 메일 링크와 건의게시판뿐이라, 뭔가 물어보고 싶어진
// 사람은 맨 아래까지 내려가야 길을 찾을 수 있었다. 오픈채팅은 그 자리에서 바로
// 말을 걸 수 있는 유일한 창구라 눈에 띄는 자리에 둔다.
//
// 다만 "모든 화면에 항상"은 아니다. 문제지·해설·오답노트는 집중해서 읽는 화면이고
// 목록 카드가 화면 아래까지 차는데, 거기에 노란 덩어리가 계속 얹혀 있으면 문의
// 창구가 아니라 방해물이 된다. 그래서 둘러보는 화면인 홈에서만 띄운다 — 사이트가
// 뭔지 살피다 물어볼 게 생기는 사람이 대부분 여기 있고, 이미 문제를 풀고 있는
// 사람은 푸터의 문의·건의게시판으로 충분하다.
//
// 자리는 오른쪽이 아니라 왼쪽 아래다 — 오른쪽 아래는 ReviewFab("복습 N")이 쓰는데,
// 그 버튼은 스크롤 위치와 오늘 복습량에 따라 나타났다 사라지므로 같은 쪽에 두면
// 서로 밀려 위치가 튄다.

// 이만큼 내려야 뜬다(ReviewFab과 같은 기준). 홈에 도착하자마자 튀어나오면 사이트가
// 뭐 하는 곳인지 보기도 전에 말부터 거는 꼴이라, 목록을 한 번 훑은 사람에게만 보인다.
const SHOW_AFTER_PX = 400;

export function KakaoChatFab() {
  const pathname = usePathname();
  const isHome = pathname === "/";
  // 첫 렌더는 언제나 false라 서버 렌더 결과(아무것도 안 그림)와 어긋나지 않는다.
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    if (!isHome) return;
    function onScroll() {
      setScrolled(window.scrollY > SHOW_AFTER_PX);
    }
    // 뒤로가기로 돌아와 스크롤 위치가 복원된 경우를 위해 한 번 직접 확인한다.
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [isHome]);

  if (!isHome || !scrolled) return null;

  return (
    <a
      href={KAKAO_OPEN_CHAT_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="공모아 카카오톡 오픈채팅방 열기"
      className="animate-modal-fade-in fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full bg-[#FEE500] p-3.5 text-sm font-bold text-black/90 shadow-lg shadow-black/10 transition-transform hover:scale-105 sm:py-3 sm:pl-4 sm:pr-5 print:hidden"
      style={{ marginBottom: "env(safe-area-inset-bottom)" }}
    >
      <KakaoIcon />
      {/* 좁은 화면에서는 아이콘만 — 노란 말풍선만으로도 뭔지 알아본다. */}
      <span className="hidden sm:inline">오픈채팅</span>
    </a>
  );
}
