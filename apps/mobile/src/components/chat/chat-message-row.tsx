import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import type { ChatMessage } from "../../queries/chat";

// 말풍선 한 줄(웹 chat-panel.tsx `<li>` 마크업 1:1). 본인 메시지는 오른쪽(items-end)·파랑, 남의 메시지는
// 왼쪽·회색 + 위에 닉네임(text-[11px] font-bold text-zinc-400). 시각은 웹도 그리지 않는다.
//
// 신고·차단 입구는 **길게 누르기**다 — 웹은 폰 브라우저의 길게 누르기가 텍스트 선택이라 말풍선 옆 작은 ⋯ 를
// 두었지만(:330-345), 앱의 Pressable 은 길게 눌러도 선택이 일어나지 않고 채팅 앱의 관례가 길게 누르기다.
// 스크린리더는 길게 누르기를 흉내 내기 어려우므로 같은 동작을 접근성 액션으로도 연다. canAct 가 아니면
// (본인·비로그인·탈퇴한 회원의 메시지) 그냥 글자다.
export function ChatMessageRow({
  message,
  mine,
  canAct,
  onAction,
}: {
  message: ChatMessage;
  mine: boolean;
  canAct: boolean;
  onAction: (message: ChatMessage) => void;
}) {
  return (
    <View className={["flex-col", mine ? "items-end" : "items-start"].join(" ")}>
      {!mine && (
        <AppText variant="11" weight="bold" className="mb-0.5 px-1 text-zinc-400">
          {message.nickname}
        </AppText>
      )}
      <Pressable
        accessibilityRole="text"
        accessibilityHint={canAct ? "길게 누르면 신고하거나 차단할 수 있어요" : undefined}
        accessibilityActions={canAct ? [{ name: "longpress", label: "더보기" }] : undefined}
        onAccessibilityAction={canAct ? () => onAction(message) : undefined}
        onLongPress={canAct ? () => onAction(message) : undefined}
        className={[
          "max-w-[85%] rounded-2xl px-3 py-2",
          mine ? "rounded-br-sm bg-blue-600" : "rounded-bl-sm bg-zinc-100 dark:bg-zinc-800",
        ].join(" ")}
      >
        <AppText variant="13" pretty className={mine ? "text-white" : "text-zinc-800 dark:text-zinc-100"}>
          {message.content}
        </AppText>
      </Pressable>
    </View>
  );
}
