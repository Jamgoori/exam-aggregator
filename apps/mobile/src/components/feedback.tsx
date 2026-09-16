import { RefreshCw, Undo2 } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "./app-text";
import { themedIcon } from "../theme/icons";

// 빈 상태·인라인 에러·되돌리기 토스트(설계서 §4.5 #11). 토스트 라이브러리는 추가하지 않는다.

// dashed rounded-2xl + 아이콘 22–28 text-zinc-300. 문구는 웹과 동일하게 호출부가 준다.
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <View
      className={[
        "items-center gap-2 rounded-2xl border border-dashed border-zinc-200 px-4 py-10 dark:border-zinc-700",
        className ?? "",
      ].join(" ")}
    >
      {icon}
      <AppText variant="sm" weight="medium" className="text-center text-zinc-600 dark:text-zinc-400" pretty>
        {title}
      </AppText>
      {description && (
        <AppText variant="xs" className="text-center text-zinc-400 dark:text-zinc-500" pretty>
          {description}
        </AppText>
      )}
      {action && <View className="mt-2">{action}</View>}
    </View>
  );
}

const RetryIcon = themedIcon(RefreshCw);

// red: `bg-red-50 text-red-600` + "다시 시도"(5xx·네트워크), amber: 429 "잠시 후 다시 시도해 주세요".
export function InlineAlert({
  tone = "red",
  message,
  onRetry,
  className,
}: {
  tone?: "red" | "amber";
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  const box =
    tone === "red"
      ? "bg-red-50 dark:bg-red-950/30"
      : "bg-amber-50 dark:bg-amber-950/30";
  const text = tone === "red" ? "text-red-600 dark:text-red-400" : "text-amber-800 dark:text-amber-300";
  return (
    <View className={["flex-row items-center gap-3 rounded-xl px-4 py-3", box, className ?? ""].join(" ")} accessibilityRole="alert">
      <AppText variant="sm" className={["min-w-0 flex-1", text].join(" ")} pretty>
        {message}
      </AppText>
      {onRetry && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="다시 시도"
          onPress={onRetry}
          className="flex-row items-center gap-1 rounded-lg px-2 py-1 active:bg-black/5"
        >
          <RetryIcon size={14} colorClassName={text} />
          <AppText variant="xs" weight="semibold" className={text}>
            다시 시도
          </AppText>
        </Pressable>
      )}
    </View>
  );
}

const UndoIcon = themedIcon(Undo2);
const UNDO_TOAST_MS = 8_000;

// 유일한 토스트(z-40, 8초). 오답노트 삭제 되돌리기 등.
//
// **반드시 `Screen` 의 `overlay` 슬롯으로 넘길 것.** 본문(ScrollView 콘텐츠) 안에 두면
// absolute 가 목록을 기준으로 잡혀 화면 밖으로 밀린다(screen.tsx ScreenOverlay 머리말).
// 바닥 여백(safe-area·탭바)은 그 슬롯이 책임지므로 여기서는 웹과 같은 `bottom-*` 클래스만
// 쓴다 — 웹 wrong-note-mark-actions.tsx 의 `bottomClass` 와 같은 자리다.
//
// 버튼 문구는 웹과 같은 "되돌리기" / 요청 중 "되돌리는 중..."(웹 WrongNoteUndoToast).
export function UndoToast({
  visible,
  message,
  onUndo,
  onDismiss,
  pending = false,
  // 하단에 선택 액션 바가 떠 있는 화면에서는 그 위로 올린다(웹 bottomClass 기본 bottom-4).
  bottomClassName = "bottom-4",
}: {
  visible: boolean;
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  pending?: boolean;
  bottomClassName?: string;
}) {
  useEffect(() => {
    if (!visible) return;
    const t = setTimeout(onDismiss, UNDO_TOAST_MS);
    return () => clearTimeout(t);
  }, [visible, onDismiss]);
  if (!visible) return null;
  const label = pending ? "되돌리는 중..." : "되돌리기";
  return (
    <View pointerEvents="box-none" className={["absolute inset-x-4 z-40 items-center", bottomClassName].join(" ")}>
      <View className="w-full max-w-md flex-row items-center gap-3 rounded-2xl bg-zinc-900 px-4 py-3 shadow-lg dark:bg-zinc-100">
        <AppText variant="sm" className="min-w-0 flex-1 text-white dark:text-zinc-900" numberOfLines={2}>
          {message}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityState={{ disabled: pending, busy: pending }}
          disabled={pending}
          onPress={onUndo}
          className={["flex-row items-center gap-1 rounded-lg px-2 py-1 active:bg-white/10", pending ? "opacity-60" : ""].join(" ")}
        >
          <UndoIcon size={14} colorClassName="text-blue-400 dark:text-blue-600" />
          <AppText variant="sm" weight="bold" className="text-blue-400 dark:text-blue-600">
            {label}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
