import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { hapticSelect } from "../../lib/haptics";

// 과목 오답노트의 "시험지별 / 문제만 모아보기" 탭(웹 wrong-note-view-tabs.tsx, 설계서 §4.5 #4
// `ViewTabs`). 웹은 ?view 쿼리로 서버 왕복이라 눌린 탭에 스피너를 띄우지만, 앱은 두 뷰가 각자
// 쿼리를 들고 있어 전환이 즉시다 — 스켈레톤은 QueryState 가 그린다. 주소(?view=questions)는
// 웹과 같게 유지해 딥링크·뒤로가기가 같은 뜻이 되게 한다.
export type WrongNoteViewKey = "papers" | "questions";

export function WrongNoteViewTabs({
  view,
  onChange,
}: {
  view: WrongNoteViewKey;
  onChange: (view: WrongNoteViewKey) => void;
}) {
  return (
    <View className="flex-row gap-2">
      <Tab value="papers" label="시험지별" view={view} onChange={onChange} />
      <Tab value="questions" label="문제만 모아보기" view={view} onChange={onChange} />
    </View>
  );
}

function Tab({
  value,
  label,
  view,
  onChange,
}: {
  value: WrongNoteViewKey;
  label: string;
  view: WrongNoteViewKey;
  onChange: (view: WrongNoteViewKey) => void;
}) {
  const active = view === value;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={() => {
        if (active) return;
        hapticSelect();
        onChange(value);
      }}
      className={[
        "flex-row items-center gap-1.5 rounded-full px-4 py-1.5",
        active
          ? "bg-blue-600"
          : "border border-zinc-200 active:border-blue-300 dark:border-zinc-700 dark:active:border-blue-700",
      ].join(" ")}
    >
      <AppText
        variant="sm"
        weight="medium"
        className={active ? "text-white" : "text-zinc-600 dark:text-zinc-400"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
