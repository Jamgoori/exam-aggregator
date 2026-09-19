import { MessageCircle } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { ChatPanel } from "./chat-panel";
import { themedIcon } from "../../theme/icons";

// 사이트 전체에서 쓰는 채팅방 입구(웹 chat-fab.tsx 1:1 — 카카오톡 오픈채팅 대체).
//
// 오픈채팅은 사이트 밖으로 나가야 했고 비회원도 아무나 들어와 도배할 수 있었다. 이제 안에서 바로 열리고,
// 실제로 보낼 때는(ChatPanel) 로그인한 회원만 쓸 수 있어 책임 있는 대화만 남는다 — 그래서 홈으로만
// 좁힐 이유가 없어져 온라인 풀이 화면만 빼고 모든 화면에 둔다.
//
// 웹은 root layout 에 두고 pathname 으로 몰입형(CBT·복습 풀이)을 뺀다. 앱은 Screen 의 immersive 플래그가
// 이미 그 판정이라 Screen 이 ReviewFab 과 같은 ScreenOverlay 슬롯에 이 컴포넌트를 그린다(몰입 화면은 슬롯
// 자체가 없다). 위치는 웹 `fixed bottom-5 left-5`(좌하단) — ReviewFab 은 우하단이라 겹치지 않는다. 앱은
// 언제나 좁은 화면(§4.4)이라 웹의 `hidden sm:inline` "채팅" 글자 없이 아이콘만. 바닥 여백(홈 인디케이터·
// 탭바)은 슬롯이 책임진다(screen.tsx useOverlayBottom).
const ChatIcon = themedIcon(MessageCircle);

export function ChatFab() {
  const [open, setOpen] = useState(false);

  return (
    // pointerEvents="box-none" — 이 View 는 오버레이 전체를 덮으므로 버튼 밖 터치는 아래 본문이 받아야 한다
    // (ReviewFab 과 같은 이유).
    <View pointerEvents="box-none" className="absolute inset-x-0 bottom-0 items-start px-5 pb-5">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="채팅방 열기"
        onPress={() => setOpen(true)}
        className="rounded-full bg-blue-600 p-3.5 shadow-lg active:bg-blue-700"
      >
        <ChatIcon size={18} colorClassName="text-white" />
      </Pressable>
      {/* 웹은 `open && <ChatPanel>` 로 마운트하지만 Sheet 는 visible 로 닫힘 애니메이션을 돌리므로 항상 둔다. */}
      <ChatPanel visible={open} onClose={() => setOpen(false)} />
    </View>
  );
}
