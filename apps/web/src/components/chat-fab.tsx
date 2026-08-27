"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { ChatPanel } from "@/components/chat-panel";

// 사이트 전체에서 쓰는 채팅방 입구(카카오톡 오픈채팅 대체).
//
// 오픈채팅은 사이트 밖으로 나가야 했고 비회원도 아무나 들어와 도배할 수 있었다.
// 이제 사이트 안에서 바로 열리고, 실제로 보낼 때는(ChatPanel) 로그인한 회원만
// 쓸 수 있어 책임 있는 대화만 남는다 — 그래서 예전처럼 홈으로만 좁힐 이유가 없어져
// 온라인 풀이 화면만 빼고 모든 화면에 둔다.
//
// 온라인 CBT·섞어풀기/복습 풀이 화면(몰입형)만 뺀다 — 판별 규칙은 site-header-gate.tsx
// 등 다른 몰입형 판별과 같다. 그 화면은 자체 헤더 + OMR로 세로 공간이 빠듯해서
// 떠 있는 버튼이 조작을 방해한다.
export function ChatFab() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  const immersive =
    /^\/papers\/[^/]+\/cbt(\/|$)/.test(pathname ?? "") ||
    /^\/mypage\/wrong-notes\/[^/]+\/review\/[^/]+/.test(pathname ?? "");

  if (immersive) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="채팅방 열기"
        className="animate-modal-fade-in fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full bg-blue-600 p-3.5 text-sm font-bold text-white shadow-lg shadow-blue-600/25 transition-transform hover:scale-105 sm:py-3 sm:pl-4 sm:pr-5 print:hidden"
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        <MessageCircle size={18} />
        {/* 좁은 화면(모바일)에서는 아이콘만 — 말풍선 아이콘만으로도 뭔지 알아본다. */}
        <span className="hidden sm:inline">채팅</span>
      </button>
      {open && <ChatPanel onClose={() => setOpen(false)} />}
    </>
  );
}
