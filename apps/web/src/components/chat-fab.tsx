"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { MessageCircle } from "lucide-react";

// 패널은 버튼을 누른 사람에게만 필요한데, 정적으로 import 하면 그 안의 Supabase
// 브라우저 SDK(실측 ~225KB, 홈 라우트 JS 의 60% 이상)가 모든 페이지의 번들에 실려
// 채팅을 열지 않는 방문자까지 내려받는다. 처음 열 때 그 청크를 가져온다 — 실시간
// 채널은 어차피 패널이 열린 뒤에야 붙으므로 동작은 같다.
const ChatPanel = dynamic(
  () =>
    import("@/components/chat-panel").then((m) => {
      // ChatPanel 은 createPortal 을 그대로 돌려줘 반환형이 ReactPortal 인데, 이
      // 모노레포에는 @types/react 가 두 벌(18·19) 있어 next/dynamic 의 제약과 타입만
      // 어긋난다. JSX 로 한 겹 감싸면 반환형이 Element 가 되어 문제가 없다.
      function ChatPanelLazy(props: { onClose: () => void }) {
        return <m.ChatPanel {...props} />;
      }
      return ChatPanelLazy;
    }),
  { ssr: false },
);

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
