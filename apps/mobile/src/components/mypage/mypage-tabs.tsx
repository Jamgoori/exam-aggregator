import { isAttendanceOpen } from "@gongmoa/core";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { hapticSelect } from "../../lib/haptics";

// 마이페이지 4탭(웹 mypage-tabs.tsx, 설계서 §4.5 #4). 순서는 쓰는 빈도순(오답노트 → 시험기록 →
// 출석체크 → 즐겨찾기), 라벨은 전부 네 글자 — 좁은 폰 화면에서도 네 개가 한 줄에 들어간다.
// 정본은 주소의 `?tab=`(§5) — 탭을 누르면 화면이 router.setParams 로 주소를 고치고 여기는 값을
// 받아 그리기만 한다. 출석체크는 기능이 닫혀 있으면(core isAttendanceOpen) 탭 자체를 빼고,
// 닫힌 탭을 가리키는 주소(?tab=attendance)는 기본 탭으로 떨어뜨린다.
export const MYPAGE_TABS = [
  { key: "wrong-notes", label: "오답노트" },
  { key: "history", label: "시험기록" },
  { key: "attendance", label: "출석체크" },
  { key: "bookmarks", label: "즐겨찾기" },
] as const;

export type MyPageTabKey = (typeof MYPAGE_TABS)[number]["key"];

const TAB_KEYS: readonly string[] = MYPAGE_TABS.map((t) => t.key);

export function isOpenTab(key: MyPageTabKey): boolean {
  return key !== "attendance" || isAttendanceOpen();
}

// 주소의 tab 값 → 지금 열 수 있는 탭. 없거나 모르는 값·닫힌 탭이면 기본(오답노트).
export function resolveMyPageTab(value: string | string[] | null | undefined): MyPageTabKey {
  const raw = Array.isArray(value) ? value[0] : value;
  const key = TAB_KEYS.includes(raw ?? "") ? (raw as MyPageTabKey) : null;
  return key && isOpenTab(key) ? key : "wrong-notes";
}

export function MyPageTabs({ value, onChange }: { value: MyPageTabKey; onChange: (key: MyPageTabKey) => void }) {
  const tabs = MYPAGE_TABS.filter((t) => isOpenTab(t.key));
  return (
    <View className="flex-row gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-700" accessibilityRole="tablist">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              if (active) return;
              hapticSelect();
              onChange(t.key);
            }}
            className={[
              "min-w-0 flex-1 items-center rounded-full px-2 py-1.5",
              active ? "bg-blue-600" : "border border-zinc-200 active:border-blue-300 dark:border-zinc-700 dark:active:border-blue-700",
            ].join(" ")}
          >
            <AppText
              variant="xs"
              weight="medium"
              numberOfLines={1}
              allowFontScaling={false}
              className={active ? "text-white" : "text-zinc-600 dark:text-zinc-400"}
            >
              {t.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
