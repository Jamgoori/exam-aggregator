import { router } from "expo-router";
import { View } from "react-native";
import { AppText } from "./app-text";
import { Button } from "./button";
import { loginHref, useCurrentHref } from "./login-link";

// 게스트 모드(설계서 §7.0): 로그인 필요 동작은 버튼을 숨기지 않고 웹과 같은 문구의 안내를
// 그 자리에 그린 뒤 /login?next=<현재 경로> 모달로 보낸다(comments-section.tsx:139-145 문구).
export function LoginPrompt({
  message = "댓글은 로그인 후 남길 수 있어요",
  className,
}: {
  message?: string;
  className?: string;
}) {
  const current = useCurrentHref();
  return (
    <View
      className={[
        "items-center gap-2 rounded-lg border border-dashed border-zinc-200 px-4 py-6 dark:border-zinc-700",
        className ?? "",
      ].join(" ")}
    >
      <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" pretty>
        {message}
      </AppText>
      <Button variant="neutralDark" label="로그인하기" onPress={() => router.push(loginHref(current))} />
    </View>
  );
}
