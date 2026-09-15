import { AppText } from "../../src/components/app-text";
import { Screen } from "../../src/components/screen";

// 랜딩 `/` — 자리 표시. 팝업·TopBanner·Hero+TodayStudy·PastQuestions·Diagnosis·ClosingCta 는
// 별도 작업에서 채운다(설계서 §5 `/` 행).
export default function HomeScreen() {
  return (
    <Screen>
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
        준비 중
      </AppText>
    </Screen>
  );
}
