import { router, type Href } from "expo-router";
import { ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 기출문제 검색창 바로 아래에 놓는 오답노트 바로가기 배너(웹 wrong-note-shortcut.tsx,
// 설계서 §4.5 #20). 마이페이지의 "남은 오답" 값을 받아 복습이 밀려 있음을 한 줄로 알리고,
// 누르면 오답노트 탭으로 바로 간다. 남은 오답이 없으면 호출부가 렌더하지 않는다(웹과 동일).
//
// 목적지는 웹 `/mypage?tab=wrong-notes#wrong-notes` 와 같은 화면이다 — 앱은 `?tab=` 이 정본이고
// `#wrong-notes` 해시는 같은 값으로 재매핑되므로(설계서 §5 마이페이지 행) 해시를 빼고 건다.
// 탭 항목과 같은 주소라 push 가 아니라 navigate 로 — 뒤로가기 스택에 같은 화면을 쌓지 않는다.
const ChevronIcon = themedIcon(ChevronRight);

const WRONG_NOTES_HREF = "/mypage?tab=wrong-notes" as Href;

export function WrongNoteShortcut({ count }: { count: number }) {
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={`복습을 기다리는 오답 ${count}문항, 오답노트로 이동`}
      onPress={() => router.navigate(WRONG_NOTES_HREF)}
      className="w-full flex-row items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-4 py-3.5 active:bg-blue-100/70 dark:border-blue-900/50 dark:bg-blue-950/25 dark:active:bg-blue-950/40"
    >
      <View className="min-w-0 flex-1">
        <AppText variant="sm" weight="bold" className="text-blue-900 dark:text-blue-100" pretty>
          현재 복습을 기다리는 오답이{" "}
          <AppText variant="sm" weight="bold" className="text-blue-600 dark:text-blue-300">
            {count}문항
          </AppText>{" "}
          있어요!
        </AppText>
        <AppText variant="xs" className="text-blue-700/70 dark:text-blue-300/60" pretty>
          오답노트에서 틀린 문제를 모아 다시 풀어보세요
        </AppText>
      </View>
      <View className="h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/70 dark:bg-blue-900/40">
        <ChevronIcon size={18} colorClassName="text-blue-500 dark:text-blue-300" />
      </View>
    </Pressable>
  );
}
