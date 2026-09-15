import { AppText } from "../../../src/components/app-text";
import { Screen } from "../../../src/components/screen";

// `/mypage?tab=wrong-notes|history|attendance|bookmarks` — 자리 표시. 4탭은 별도 작업(설계서 §5).
export default function MypageScreen() {
  return (
    <Screen>
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
        준비 중
      </AppText>
    </Screen>
  );
}
