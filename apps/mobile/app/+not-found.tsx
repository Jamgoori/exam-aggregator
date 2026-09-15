import { router, Stack } from "expo-router";
import { FileQuestion } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../src/components/app-text";
import { Button } from "../src/components/button";
import { Screen } from "../src/components/screen";
import { themedIcon } from "../src/theme/icons";

// 웹 app/not-found.tsx 1:1. 딥링크·next 화이트리스트 실패, 아직 이식되지 않은 드로어 항목도
// 여기로 온다(설계서 §5 미매칭 행).
const Icon = themedIcon(FileQuestion);

export default function NotFoundScreen() {
  return (
    <>
      <Stack.Screen options={{ title: "페이지를 찾을 수 없습니다" }} />
      <Screen>
        <View className="w-full max-w-3xl items-center gap-4 self-center px-4 py-32">
          <Icon size={48} colorClassName="text-zinc-300 dark:text-zinc-600" />
          <AppText variant="2xl" weight="bold" className="text-center text-zinc-900 dark:text-zinc-100">
            페이지를 찾을 수 없습니다
          </AppText>
          <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400" pretty>
            주소가 잘못되었거나, 삭제된 페이지일 수 있어요.
          </AppText>
          <Button
            label="홈으로 돌아가기"
            className="mt-2 rounded-full px-5 py-2"
            textClassName="font-medium"
            onPress={() => router.replace("/")}
          />
        </View>
      </Screen>
    </>
  );
}
