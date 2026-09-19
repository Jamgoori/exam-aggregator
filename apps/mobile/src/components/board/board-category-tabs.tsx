import { BOARD_CATEGORIES } from "@gongmoa/core";
import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "../app-text";

// 말머리 탭(웹 board/page.tsx CategoryTab). 현재 탭은 파랑(웹 bg-blue-600)으로 채워 어디를 보고
// 있는지 한눈에 든다. 웹은 각 탭이 `/board?category=` 링크지만 앱은 화면이 라우트 파라미터를 바꾼다
// (onChange) — 주소 모양은 같다(딥링크 `/board?category=question` 이 그대로 열린다).
export function BoardCategoryTabs({
  category,
  onChange,
}: {
  category: string | undefined;
  // undefined = 전체.
  onChange: (next: string | undefined) => void;
}) {
  return (
    // 웹 `-mx-4 overflow-x-auto px-4 pb-1` — 화면 패딩을 뚫고 가로로 넘친다.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} className="-mx-4" contentContainerClassName="px-4 pb-1">
      <View className="flex-row gap-1.5">
        <CategoryTab label="전체" active={!category} onPress={() => onChange(undefined)} />
        {BOARD_CATEGORIES.map((c) => (
          <CategoryTab key={c.slug} label={c.label} active={category === c.slug} onPress={() => onChange(c.slug)} />
        ))}
      </View>
    </ScrollView>
  );
}

function CategoryTab({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={[
        "shrink-0 rounded-full px-3.5 py-1.5",
        active ? "bg-blue-600" : "bg-zinc-100 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700",
      ].join(" ")}
    >
      <AppText variant="sm" weight="medium" className={active ? "text-white" : "text-zinc-600 dark:text-zinc-300"}>
        {label}
      </AppText>
    </Pressable>
  );
}
