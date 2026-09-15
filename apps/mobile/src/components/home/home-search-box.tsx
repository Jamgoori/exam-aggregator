import { getSubjectNameForQuery, matchSubjectIds, parseSearchQuery, type Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Search } from "lucide-react-native";
import { useDeferredValue, useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { SearchSuggestionList, type SearchSuggestion } from "../papers/search-suggestions";
import { themedIcon } from "../../theme/icons";

// 홈(랜딩)의 기출문제 검색창(웹 home-search-box.tsx, 설계서 §4.5 #6). 제출(엔터·"검색")은
// 예전처럼 /papers?q= 로 가고, 과목명을 치는 동안에는 기출문제 목록과 같은 과목 추천(≤6)이
// 아래에 뜬다(누르면 그 과목 페이지로). 시행처 이름은 "국가직 행정법"처럼 섞어 친 검색어에서
// 과목명만 떼어내는 데 쓴다. 규칙은 core parseSearchQuery → matchSubjectIds 하나라 두 화면의
// 추천이 어긋나지 않는다(웹 lib/subject-suggestions.ts getSubjectSuggestions).
const SUBJECT_SUGGESTION_LIMIT = 6;
const SearchIcon = themedIcon(Search);

export function getSubjectSuggestions(
  subjects: Subject[],
  rawQuery: string,
  examTypeNames: string[],
): SearchSuggestion[] {
  const { subjectQuery } = parseSearchQuery(rawQuery, examTypeNames);
  if (!subjectQuery.trim()) return [];
  const byId = new Map(subjects.map((s) => [s.id, s]));
  return matchSubjectIds(subjects, subjectQuery)
    .slice(0, SUBJECT_SUGGESTION_LIMIT)
    .map((id) => byId.get(id))
    .filter((s): s is Subject => !!s)
    .map((s) => ({
      slug: s.slug,
      // 보여주는 이름은 방금 친 검색어에 맞춘다 — "행정법"을 쳤는데 "행정법총론"으로 뜨면
      // 찾는 과목이 없어서 비슷한 걸 내준 것처럼 읽힌다.
      name: getSubjectNameForQuery(s.name, subjectQuery),
    }));
}

export function HomeSearchBox({ subjects, examTypeNames }: { subjects: Subject[]; examTypeNames: string[] }) {
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  // 과목 수가 수백 개라 매 글자마다 필터가 도는데, 입력 자체가 밀리지 않도록 한 박자 늦춘다.
  const deferredQuery = useDeferredValue(query);
  const suggestions = useMemo(
    () => getSubjectSuggestions(subjects, deferredQuery, examTypeNames),
    [subjects, deferredQuery, examTypeNames],
  );
  const open = focused && suggestions.length > 0;

  function submit() {
    const q = query.trim();
    router.push((q ? { pathname: "/papers", params: { q } } : "/papers") as Href);
  }

  return (
    <View className="mt-8">
      <View
        accessibilityRole="search"
        className="flex-row items-center rounded-xl border border-zinc-200 bg-white p-1.5 shadow-sm dark:border-zinc-700 dark:bg-zinc-950"
      >
        <View className="ml-2.5 shrink-0">
          <SearchIcon size={18} colorClassName="text-zinc-400" />
        </View>
        <TextInput
          accessibilityLabel="기출문제 검색"
          value={query}
          onChangeText={setQuery}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onSubmitEditing={submit}
          placeholder="예: 2025 국가직 행정법, 9급 국어"
          placeholderTextColorClassName="text-zinc-400"
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          maxFontSizeMultiplier={1.3}
          className="min-w-0 flex-1 px-3 py-3 text-sm leading-5 text-zinc-900 dark:text-zinc-100"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="검색"
          onPress={submit}
          className="rounded-lg bg-[#012854] px-4 py-2.5 active:bg-[#0a3a72] dark:bg-[#0a7d5b] dark:active:bg-[#096b4e]"
        >
          <AppText variant="sm" weight="bold" className="text-white">
            검색
          </AppText>
        </Pressable>
      </View>

      {open && <SearchSuggestionList suggestions={suggestions} />}
    </View>
  );
}
