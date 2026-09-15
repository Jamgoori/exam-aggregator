import { getSubjectShortName, matchSubjectIds, type Subject } from "@gongmoa/core";
import { Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ScrollView, TextInput, View } from "react-native";
import { SubjectBookmarkButton } from "./subject-bookmark-button";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// /papers 의 "즐겨찾기한 과목만 보기" 옆 + 버튼으로 펼치는 과목 추가 패널(웹 subject-quick-add.tsx).
// 과목 이름을 쳐서 찾고, 그 자리에서 별을 눌러 즐겨찾기에 넣고 뺀다. 검색 규칙은 검색창과
// 같은 core matchSubjectIds(초성 검색·앞글자 우선).
const SearchIcon = themedIcon(Search);

export function SubjectQuickAdd({
  subjects,
  onToggle,
}: {
  subjects: Subject[];
  onToggle: (subjectId: string, bookmarked: boolean) => void;
}) {
  const [query, setQuery] = useState("");

  const visibleSubjects = useMemo(() => {
    if (!query.trim()) return subjects;
    const ids = new Set(matchSubjectIds(subjects, query));
    return subjects.filter((s) => ids.has(s.id));
  }, [subjects, query]);

  return (
    <View className="w-full rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
      <View className="flex-row items-center rounded-lg border border-zinc-200 py-2 pl-3 pr-3 focus:border-blue-400 dark:border-zinc-700">
        <SearchIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-500" />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="과목 이름으로 찾기 (예: 국어, ㄱㅇ)"
          placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
          autoCorrect={false}
          maxFontSizeMultiplier={1.3}
          className="ml-2 min-w-0 flex-1 p-0 text-sm leading-5 text-zinc-900 dark:text-zinc-100"
        />
      </View>

      {visibleSubjects.length === 0 ? (
        <AppText variant="sm" className="py-6 text-center text-zinc-500 dark:text-zinc-500">
          찾는 과목이 없어요.
        </AppText>
      ) : (
        <ScrollView className="mt-3 max-h-64" contentContainerClassName="gap-2" nestedScrollEnabled keyboardShouldPersistTaps="handled">
          {visibleSubjects.map((s) => (
            <View
              key={s.id}
              className="flex-row items-center gap-1 rounded-lg border border-zinc-200 py-1 pl-3 pr-1.5 dark:border-zinc-700"
            >
              <AppText variant="sm" numberOfLines={1} className="min-w-0 flex-1">
                {getSubjectShortName(s.name)}
              </AppText>
              <SubjectBookmarkButton subjectId={s.id} size="sm" onToggled={(next) => onToggle(s.id, next)} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
