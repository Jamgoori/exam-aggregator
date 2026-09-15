import { AppText } from "../../../src/components/app-text";
import { Screen } from "../../../src/components/screen";

// `/papers?q&level&type&fav&page` — 자리 표시. PapersBrowser 는 별도 작업(설계서 §4.5 #20).
export default function PapersScreen() {
  return (
    <Screen>
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
        준비 중
      </AppText>
    </Screen>
  );
}
