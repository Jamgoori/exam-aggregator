import { Search } from "lucide-react-native";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { SearchSuggestionList, type SearchSuggestion } from "./search-suggestions";
import { themedIcon } from "../../theme/icons";

// 기출문제 검색창(웹 search-input.tsx, 설계서 §4.5 #6): `rounded-2xl border-2 px-5 py-4`, 포커스
// `border-blue-400` + `ring-4 ring-blue-100`(RN 에는 ring 이 없어 바깥 테두리 View 로 그린다).
// 값은 그대로 보여주고 바뀐 값을 부모에 올려보내기만 한다 — 필터링은 부모(PapersBrowser).
const SearchIcon = themedIcon(Search);

export function SearchInput({
  value,
  onChange,
  suggestions = [],
}: {
  value: string;
  onChange: (next: string) => void;
  suggestions?: SearchSuggestion[];
}) {
  const [focused, setFocused] = useState(false);
  const open = focused && suggestions.length > 0;

  return (
    <View className="w-full">
      <View
        className={[
          "rounded-[20px] border-4",
          focused ? "border-blue-100 dark:border-blue-950/40" : "border-transparent",
        ].join(" ")}
      >
        <View
          className={[
            "flex-row items-center gap-3 rounded-2xl border-2 bg-white px-5 py-4 shadow-sm dark:bg-zinc-900",
            focused ? "border-blue-400 dark:border-blue-600" : "border-zinc-200 dark:border-zinc-700",
          ].join(" ")}
        >
          <SearchIcon size={22} colorClassName="text-blue-400" />
          <TextInput
            accessibilityLabel="과목명으로 검색"
            value={value}
            onChangeText={onChange}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // 과목명뿐 아니라 급수·연도·시행처를 섞어 쳐도 되는 검색창이라 예시로 보여준다.
            placeholder="예: 2024 국가직 행정법, 9급 국어"
            placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
            returnKeyType="search"
            autoCorrect={false}
            maxFontSizeMultiplier={1.3}
            className="min-w-0 flex-1 p-0 text-base leading-6 text-zinc-900 dark:text-zinc-100"
          />
        </View>
      </View>

      {open && <SearchSuggestionList suggestions={suggestions} />}
    </View>
  );
}
