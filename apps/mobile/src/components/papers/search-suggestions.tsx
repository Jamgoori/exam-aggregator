import { router, type Href } from "expo-router";
import { Search } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 검색창 아래 과목 추천(웹 search-suggestions.tsx). 드롭다운 대신 인라인 리스트(설계서 §4.5
// #6) — IME 가드·화살표 키·포커스 유지 트릭은 필요 없다. 누르면 그 과목 페이지로 간다.
export type SearchSuggestion = {
  /** 눌렀을 때 갈 과목 페이지(/subjects/:slug) */
  slug: string;
  /** 화면에 보일 이름 — 방금 친 검색어에 맞춘 표기가 이미 적용된 값 */
  name: string;
};

const SearchIcon = themedIcon(Search);

export function SearchSuggestionList({
  suggestions,
  onNavigate,
  className,
}: {
  suggestions: SearchSuggestion[];
  onNavigate?: () => void;
  className?: string;
}) {
  if (suggestions.length === 0) return null;
  return (
    <View
      accessibilityRole="list"
      accessibilityLabel="과목 바로가기"
      className={[
        "mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white py-1.5 shadow-xl shadow-zinc-900/10 dark:border-zinc-700 dark:bg-zinc-900 dark:shadow-black/40",
        className ?? "",
      ].join(" ")}
    >
      {suggestions.map((s) => (
        <Pressable
          key={s.slug}
          accessibilityRole="link"
          onPress={() => {
            onNavigate?.();
            router.push(`/subjects/${s.slug}` as Href);
          }}
          className="flex-row items-center gap-2.5 px-4 py-2.5 active:bg-blue-50 dark:active:bg-blue-950/40"
        >
          <SearchIcon size={14} colorClassName="text-zinc-400" />
          <AppText variant="sm" weight="medium" numberOfLines={1} className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
            {s.name}
          </AppText>
          <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-500">
            과목 페이지로 이동
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}
