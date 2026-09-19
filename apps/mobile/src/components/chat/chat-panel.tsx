import { CHAT_CONTENT_MAX } from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { MessageCircle, Send, X } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Dimensions,
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChatMessageRow } from "./chat-message-row";
import { AppText } from "../app-text";
import { BLOCK_CONFIRM_BODY, BLOCK_CONFIRM_TITLE } from "../board/board-post-actions";
import { BoardReportSheet } from "../board/board-report-sheet";
import { loginHref, useCurrentHref } from "../login-link";
import { Sheet } from "../sheet";
import { useAuth } from "../../providers/auth-provider";
import { useBlockUser } from "../../queries/board";
import { chatSendErrorMessage, useChatRoom, useSendChatMessage, useVisibleChatMessages, type ChatMessage } from "../../queries/chat";
import { tokens, useIsDark } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 채팅 패널(웹 components/chat-panel.tsx 1:1, 설계서 §6.7 #32 — 좌하단 앵커 Sheet 85%). 머리(그라데이션·
// 제목·닫기), 목록(버블 max-w-[85%] rounded-2xl text-[13px], 본인 오른쪽), 입력줄(rounded-full 입력 + 보내기)
// 을 웹 마크업 순서 그대로 둔다. 데이터·구독 생명주기는 queries/chat.ts(useChatRoom), 전송은 EF chat-send.
//
// Sheet 의 title/icon 헤더는 부제 한 줄("누구나 볼 수 있어요 · …")과 머리 그라데이션을 받지 못해 헤더를
// 여기서 직접 그린다 — 그래서 드래그로 닫기는 Sheet 의 핸들에서만 받는다(헤더는 제스처 밖).
//
// 높이: Sheet 는 자식 상자를 `min-h-0 shrink`(flexGrow 없음)로 감싸므로 안에서 `flex-1` 을 줘도 채워지지
// 않는다. 그래서 본문 상자에 "화면 85% − 핸들 − 홈 인디케이터 − 키보드" 를 명시하고 `shrink` 를 함께 둔다:
// Sheet 의 maxHeight(85%) 에 걸리면 목록이 줄고, 키보드가 올라오면(Sheet 의 KeyboardAvoidingView padding)
// 그만큼 뺀 높이라 패널 위 가장자리가 그 자리에 머문다 — 85% 를 고정 height 로 넘기면 iOS 에서 키보드 높이
// 만큼 머리가 화면 위로 밀려 나간다.
const PANEL_HEIGHT_RATIO = 0.85;
// Sheet 핸들(pt-2.5 + h-1 + pb-1 = 18). 값이 어긋나도 shrink 사슬이 몇 px 를 흡수하므로 깨지지는 않는다.
const SHEET_HANDLE_HEIGHT = 18;
// 키보드 높이를 잘못 받는 경우의 하한 — 입력줄과 머리 사이에 최소한 몇 줄은 남긴다.
const MIN_BODY_HEIGHT = 240;
// 이 안에 있을 때만 새 메시지에 맞춰 자동으로 따라 내려간다(웹 AUTOSCROLL_THRESHOLD_PX) — 지난 대화를
// 읽으려고 위로 올려둔 사람을 방해하지 않는다.
const AUTOSCROLL_THRESHOLD_PX = 120;

const ChatIcon = themedIcon(MessageCircle);
const CloseIcon = themedIcon(X);
const SendIcon = themedIcon(Send);

// 웹 `from-blue-50/80`·`dark:from-blue-950/30` 같은 알파 색을 토큰 hex 에서 만든다(LinearGradient 는 색 값을
// prop 으로 받아 className 이 안 먹는다 — theme/index.ts 머리 주석).
function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 키보드 높이. iOS 는 Will 이벤트(애니메이션과 같이 움직인다), Android 는 Did 이벤트만 온다.
function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}

export function ChatPanel({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    // 웹 오버레이 bg-zinc-900/40 dark:bg-black/60(backdrop-blur 는 RN 에 없다). 본문(ChatRoom)은 Sheet 가
    // 마운트된 동안만 살아서 구독도 그 동안만 — 닫힘 애니메이션 200ms 뒤 언마운트되며 해제된다.
    <Sheet visible={visible} onClose={onClose} maxHeight="85%" overlayClassName="bg-zinc-900/40 dark:bg-black/60">
      <ChatRoom onClose={onClose} />
    </Sheet>
  );
}

function ChatRoom({ onClose }: { onClose: () => void }) {
  const { userId, loading } = useAuth();
  const dark = useIsDark();
  const t = dark ? tokens.dark : tokens.light;
  const insets = useSafeAreaInsets();
  const current = useCurrentHref();

  const { messages, append } = useChatRoom();
  const visible = useVisibleChatMessages(messages);
  const send = useSendChatMessage();
  const block = useBlockUser();

  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockError, setBlockError] = useState<string | null>(null);
  // 신고 시트가 열린 메시지 id.
  const [reportId, setReportId] = useState<string | null>(null);

  // 본문 높이(파일 머리 주석). 기준은 마운트 시점의 창 높이 — Android 가 adjustResize 로 창을 줄이면
  // useWindowDimensions 가 작아지므로 키보드를 두 번 빼지 않으려고 기준값은 고정한다.
  const [baseHeight] = useState(() => Dimensions.get("window").height);
  const { height: windowHeight } = useWindowDimensions();
  const keyboard = useKeyboardHeight();
  const bodyHeight = Math.max(
    MIN_BODY_HEIGHT,
    Math.round(baseHeight * PANEL_HEIGHT_RATIO) - SHEET_HANDLE_HEIGHT - insets.bottom - keyboard,
  );
  // Android 에서 Modal 창이 키보드에 맞춰 줄지 않았으면(statusBarTranslucent Modal 의 알려진 사정) 그만큼
  // 아래 여백을 두어 입력줄이 키보드 위로 올라오게 한다. 창이 줄었으면 이미 올라와 있으니 두지 않는다.
  const lift = Platform.OS === "android" && keyboard > 0 && windowHeight >= baseHeight - 1 ? keyboard : 0;

  // 목록은 inverted FlatList — 데이터를 최신순으로 뒤집어 index 0 이 화면 맨 아래다. 웹의 "바닥 근처일 때만
  // 따라 내려간다"(:224-231) 는 maintainVisibleContentPosition 이 그대로 해 준다: 위로 올려 읽는 중이면
  // 새 메시지가 붙어도 보던 자리가 고정되고, 바닥에서 AUTOSCROLL_THRESHOLD_PX 안이면 새 메시지로 내려간다.
  // 첫 이력도 최신 메시지가 바로 바닥에 그려져 scrollToEnd 가 필요 없다.
  const newestFirst = useMemo(() => (visible ? [...visible].reverse() : null), [visible]);

  async function submit() {
    const content = input.trim();
    if (!content || send.isPending) return;
    setError(null);
    try {
      const sent = await send.mutateAsync(content);
      setInput("");
      append(sent);
    } catch (e) {
      const handled = await chatSendErrorMessage(e, { next: current });
      // 401 은 로그인 모달로 보내졌다 — Modal 인 패널이 그 위에 남지 않게 닫는다.
      if (handled.redirected) {
        onClose();
        return;
      }
      setError(handled.message);
    }
  }

  function confirmBlock(targetId: string) {
    Alert.alert(BLOCK_CONFIRM_TITLE, BLOCK_CONFIRM_BODY, [
      { text: "취소", style: "cancel" },
      {
        text: "차단",
        style: "destructive",
        onPress: () => {
          setBlockError(null);
          // 성공하면 blocks 캐시가 바뀌어 그 사용자의 메시지가 곧바로 사라진다(웹은 집합에 직접 넣고
          // router.refresh — 앱은 게시판도 같은 캐시를 읽으므로 그것으로 끝).
          block.mutate(targetId, { onError: (e) => setBlockError(e.message) });
        },
      },
    ]);
  }

  // 길게 누르기 → 신고 / 이 사용자 차단(웹 ⋯ 메뉴의 두 항목·순서 그대로). OS Alert 로 고른다 — 항목이 둘이라
  // 시트를 하나 더 겹칠 이유가 없고, Android Alert 의 버튼 상한(3)도 안 넘는다. 제목·본문은 새 문구 대신
  // 닉네임·메시지 원문(어느 메시지를 고른 건지 보여 준다).
  function openActions(message: ChatMessage) {
    const targetId = message.userId;
    if (!targetId) return;
    Alert.alert(message.nickname, message.content, [
      { text: "신고", onPress: () => setReportId(message.id) },
      { text: "이 사용자 차단", style: "destructive", onPress: () => confirmBlock(targetId) },
      { text: "취소", style: "cancel" },
    ]);
  }

  function goLogin() {
    // 로그인은 라우트(모달)라 Modal 인 패널 위에 뜰 수 없다 — 먼저 닫고 보낸다. 웹은 페이지 이동이라 자연히
    // 패널이 사라진다.
    onClose();
    router.push(loginHref(current));
  }

  const canSend = !send.isPending && input.trim().length > 0;

  return (
    <View className="min-h-0 shrink" style={{ height: bodyHeight, marginBottom: lift }}>
      <LinearGradient
        colors={[withAlpha(t.blue[dark ? "950" : "50"], dark ? 0.3 : 0.8), withAlpha(t.blue[dark ? "950" : "50"], 0)] as const}
        className="flex-row items-center gap-3 border-b border-zinc-100 px-4 pt-3 pb-3 dark:border-zinc-800"
      >
        <LinearGradient
          colors={[t.blue["500"], t.blue["600"]] as const}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className="h-9 w-9 shrink-0 items-center justify-center rounded-xl"
        >
          <ChatIcon size={17} colorClassName="text-white" />
        </LinearGradient>
        <View className="min-w-0 flex-1">
          <AppText variant="15" weight="bold" className="tracking-tight">
            공모아 채팅방
          </AppText>
          <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-400">
            누구나 볼 수 있어요 · 채팅은 회원만 할 수 있어요
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="닫기"
          onPress={onClose}
          className="-mr-1 h-8 w-8 shrink-0 items-center justify-center rounded-full active:bg-white/70 dark:active:bg-zinc-800"
        >
          <CloseIcon size={17} colorClassName="text-zinc-400 dark:text-zinc-500" />
        </Pressable>
      </LinearGradient>

      <View className="min-h-0 flex-1">
        {newestFirst === null ? (
          <AppText variant="xs" className="px-4 py-8 text-center text-zinc-400">
            불러오는 중…
          </AppText>
        ) : newestFirst.length === 0 ? (
          <AppText variant="xs" pretty className="px-4 py-8 text-center text-zinc-400">
            아직 메시지가 없어요. 첫 메시지를 남겨보세요.
          </AppText>
        ) : (
          <FlatList
            data={newestFirst}
            inverted
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => {
              const mine = userId !== null && userId === item.userId;
              // 남의 메시지에만, 로그인했을 때만(비로그인은 메뉴 없음). 탈퇴한 회원(null)의 메시지는 차단할
              // 대상이 없어 열지 않는다 — 게시판 상세의 더보기와 같은 규칙(웹 :311).
              const canAct = !mine && userId !== null && item.userId !== null;
              return <ChatMessageRow message={item} mine={mine} canAct={canAct} onAction={openActions} />;
            }}
            maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: AUTOSCROLL_THRESHOLD_PX }}
            keyboardShouldPersistTaps="handled"
            className="min-h-0 flex-1"
            contentContainerClassName="gap-2.5 px-4 py-3"
          />
        )}
        {blockError && (
          <AppText variant="11" accessibilityRole="alert" className="px-5 pt-2 text-rose-500">
            {blockError}
          </AppText>
        )}
      </View>

      <View className="border-t border-zinc-100 px-3 py-2.5 dark:border-zinc-800">
        {loading ? null : userId === null ? (
          <View className="flex-row items-center justify-between gap-2 rounded-xl bg-blue-50 px-3 py-2.5 dark:bg-blue-950/30">
            <AppText variant="xs" weight="medium" pretty className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-300">
              로그인하고 채팅에 참여해보세요.
            </AppText>
            {/* 웹 LoginLink(text-[12px]) — 앱 LoginLink 는 text-sm 고정이라 같은 마크업을 직접 그린다. */}
            <Pressable accessibilityRole="link" onPress={goLogin} className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 active:bg-blue-700">
              <AppText variant="xs" weight="bold" className="text-white">
                로그인
              </AppText>
            </Pressable>
          </View>
        ) : (
          <View className="gap-1">
            <View className="flex-row items-end gap-2">
              <TextInput
                value={input}
                onChangeText={(text) => {
                  setInput(text);
                  if (error) setError(null);
                }}
                maxLength={CHAT_CONTENT_MAX}
                placeholder="메시지를 입력하세요"
                placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
                accessibilityLabel="메시지 입력"
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={() => void submit()}
                returnKeyType="send"
                // 보낸 뒤에도 키보드를 내리지 않는다(웹은 input 에 포커스가 남는다).
                submitBehavior="submit"
                maxFontSizeMultiplier={1.3}
                className={[
                  "min-w-0 flex-1 rounded-full border px-3.5 py-2 text-[13px] leading-5 text-zinc-900 dark:text-zinc-100",
                  focused
                    ? "border-blue-400 bg-white dark:border-blue-400 dark:bg-zinc-900"
                    : "border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800",
                ].join(" ")}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="보내기"
                accessibilityState={{ disabled: !canSend, busy: send.isPending }}
                disabled={!canSend}
                onPress={() => void submit()}
                className={[
                  "h-9 w-9 shrink-0 items-center justify-center rounded-full bg-blue-600 active:bg-blue-700",
                  canSend ? "" : "opacity-40",
                ].join(" ")}
              >
                <SendIcon size={15} colorClassName="text-white" />
              </Pressable>
            </View>
            {error && (
              <AppText variant="11" accessibilityRole="alert" className="px-1 text-rose-500">
                {error}
              </AppText>
            )}
          </View>
        )}
      </View>

      {/* 신고 시트는 게시판·건의글과 같은 화면(board-report-sheet.tsx) — 대상 종류만 다르다. 제목은 웹
          board-report-dialog 와 같은 조립(reportTargetLabel + " 신고" = "채팅 메시지 신고"). 채팅 Sheet(Modal)
          안에서 열리는 중첩 Modal 이다 — RN 은 iOS·Android 모두 Modal 안의 Modal 을 지원한다. */}
      <BoardReportSheet
        target="chat_message"
        postId={reportId ?? ""}
        visible={reportId !== null}
        onClose={() => setReportId(null)}
      />
    </View>
  );
}
