import { LogOut } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable } from "react-native";
import { AppText } from "./app-text";
import { signOut } from "../lib/auth";
import { themedIcon } from "../theme/icons";

// 계정 메뉴 맨 아래 로그아웃(웹 sign-out-button.tsx). 누른 즉시 pending "로그아웃 중...".
// 모양은 다른 메뉴 줄과 같고, 색은 pressed 때만 붉게(웹 hover:bg-red-50 hover:text-red-600).
const Icon = themedIcon(LogOut);

export function SignOutButton({ onDone }: { onDone?: () => void }) {
  const [pending, setPending] = useState(false);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: pending, busy: pending }}
      disabled={pending}
      onPress={async () => {
        setPending(true);
        try {
          await signOut();
          onDone?.();
        } catch (e) {
          Alert.alert("로그아웃 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
        } finally {
          setPending(false);
        }
      }}
      className={[
        "w-full flex-row items-center gap-2.5 rounded-lg px-2.5 py-2 active:bg-red-50 dark:active:bg-red-950/30",
        pending ? "opacity-50" : "",
      ].join(" ")}
    >
      <Icon size={16} colorClassName="text-zinc-500 dark:text-zinc-400" />
      <AppText variant="sm" weight="medium" className="text-zinc-500 dark:text-zinc-400">
        {pending ? "로그아웃 중..." : "로그아웃"}
      </AppText>
    </Pressable>
  );
}
