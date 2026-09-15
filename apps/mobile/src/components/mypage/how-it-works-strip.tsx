import { View } from "react-native";
import { AppText } from "../app-text";

// 오답노트가 돌아가는 사이클을 처음 온 사람에게 한 줄로 알려주는 스트립(웹 mypage/page.tsx
// HowItWorksStrip:673). "극복"이라는 용어의 정의가 앱 어디에도 없어서 여기서 처음 가르친다.
const STEPS = [
  { n: 1, text: "CBT에서 틀린 문제가 자동으로 저장돼요" },
  { n: 2, text: "모아서 다시 풀어요" },
  { n: 3, text: "다시 맞히면 '극복'으로 바뀌어요" },
];

export function HowItWorksStrip() {
  return (
    <View className="gap-2 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/50">
      {STEPS.map((s) => (
        <View key={s.n} className="flex-row items-center gap-2">
          <View
            className={[
              "h-5 w-5 shrink-0 items-center justify-center rounded-full",
              s.n === 3 ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-700",
            ].join(" ")}
          >
            <AppText
              variant="11"
              weight="bold"
              allowFontScaling={false}
              className={s.n === 3 ? "text-white" : "text-zinc-700 dark:text-zinc-300"}
            >
              {s.n}
            </AppText>
          </View>
          <AppText variant="xs" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400" pretty>
            {s.text}
          </AppText>
        </View>
      ))}
    </View>
  );
}
