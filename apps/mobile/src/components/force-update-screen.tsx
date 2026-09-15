import { Linking, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "./app-text";
import { Button } from "./button";

// 강제 업데이트(설계서 §6.6). /api/app/config 의 minBuild 미만이거나 Edge 가 426 을 주면
// 루트가 이 화면만 그린다 — 뒤로 갈 곳이 없다.
export function ForceUpdateScreen({ message, storeUrl }: { message: string | null; storeUrl: string | null }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="flex-1 items-center justify-center gap-4 bg-background px-6"
      style={{ paddingTop: insets.top, paddingBottom: insets.bottom }}
    >
      <AppText variant="2xl" weight="bold" className="text-center" pretty>
        업데이트가 필요해요
      </AppText>
      <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400" pretty>
        {message ?? "새 버전이 필요해요. 스토어에서 업데이트한 뒤 다시 열어 주세요."}
      </AppText>
      {storeUrl && (
        <Button
          label="스토어에서 업데이트"
          className="mt-2 min-w-[12rem]"
          onPress={() => void Linking.openURL(storeUrl).catch(() => {})}
        />
      )}
    </View>
  );
}
