import { matchSubjectIds, subjectColor, type Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight, Search } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 섞어풀기 허브의 과목 고르기(웹 mix-subject-picker.tsx 1:1). 자료가 있는 과목이 수십 개라
// 목록만 두면 스크롤로 찾아야 해서, 검색창을 함께 둔다.
//
// 매칭 규칙은 사이트 검색과 같은 함수(core matchSubjectIds)를 쓴다 — 초성 검색("ㄱㅇ" → 국어)
// 까지 그대로 되고, 홈 검색창과 다른 결과가 나오지 않는다. 필터링은 서버 왕복 없이 이 자리에서
// 한다(목록이 이미 손에 있다).
const SearchIcon = themedIcon(Search);
const ChevronIcon = themedIcon(ChevronRight);

export type MixPickerSubject = {
  slug: string;
  name: string;
  // 고른 급수 기준 수(급수를 안 골랐으면 과목 전체). 단위는 unit 이 정한다.
  count: number;
  favorite: boolean;
};

export function MixSubjectPicker({
  subjects,
  level,
  unit,
  emptyMessage,
}: {
  subjects: MixPickerSubject[];
  // 허브에서 고른 급수. 과목 시작 화면 주소에 그대로 이어 붙인다(없으면 전체).
  level: string | null;
  // 카드 숫자의 단위. 집계 함수가 아직 없는 환경에서는 문제지 수로 떨어진다.
  unit: "question" | "paper";
  // 급수 필터 때문에 목록 자체가 빈 경우의 안내(검색 결과가 없는 것과 다른 상황이다).
  emptyMessage: string;
}) {
  const [query, setQuery] = useState("");

  const hrefFor = (slug: string): Href =>
    (level ? `/subjects/${slug}/mix?level=${encodeURIComponent(level)}` : `/subjects/${slug}/mix`) as Href;

  // matchSubjectIds 는 Subject 를 받아 id 를 돌려준다. 여기서는 slug 가 곧 키라 id 자리에 slug 를
  // 넣어 그대로 쓴다(같은 규칙을 두 번 적지 않으려는 것).
  const asSubjects = useMemo<Subject[]>(
    () => subjects.map((s) => ({ id: s.slug, slug: s.slug, name: s.name, display_order: 0 })),
    [subjects],
  );

  const visible = useMemo(() => {
    const q = query.trim();
    if (!q) return subjects;
    const matched = new Set(matchSubjectIds(asSubjects, q));
    return subjects.filter((s) => matched.has(s.slug));
  }, [subjects, asSubjects, query]);

  return (
    <View className="gap-3">
      <View className="flex-row items-center gap-2 rounded-full border border-zinc-200 bg-white px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-900">
        <SearchIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-600" />
        <TextInput
          accessibilityLabel="과목 검색"
          value={query}
          onChangeText={setQuery}
          placeholder="과목 검색 (예: 국어, ㄱㅇ, 행정)"
          placeholderTextColorClassName="text-zinc-400 dark:text-zinc-600"
          returnKeyType="search"
          autoCorrect={false}
          maxFontSizeMultiplier={1.3}
          className="min-w-0 flex-1 p-0 text-sm text-zinc-900 dark:text-zinc-100"
        />
      </View>

      {subjects.length === 0 ? (
        <AppText variant="sm" className="py-16 text-center text-zinc-500 dark:text-zinc-500" pretty>
          {emptyMessage}
        </AppText>
      ) : visible.length === 0 ? (
        <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
          “{query.trim()}”와 맞는 과목이 없어요. 다른 이름으로 찾아보세요.
        </AppText>
      ) : (
        <View className="gap-3">
          {visible.map((s) => {
            const color = subjectColor(s.slug);
            return (
              <Pressable
                key={s.slug}
                accessibilityRole="link"
                onPress={() => router.push(hrefFor(s.slug))}
                className="flex-row items-center gap-3 rounded-xl border border-zinc-200 p-4 active:border-blue-300 active:bg-blue-50/40 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/20"
              >
                <View className={["shrink-0 rounded px-2 py-0.5", color].join(" ")}>
                  <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
                    {s.name}
                  </AppText>
                </View>
                <AppText variant="xs" numberOfLines={1} className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-500">
                  {s.favorite ? <AppText variant="xs" className="text-amber-500">★ </AppText> : null}
                  기출 {s.count.toLocaleString()}
                  {unit === "question" ? "문항" : "장"}
                </AppText>
                <View className="shrink-0 flex-row items-center gap-0.5">
                  <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
                    섞어풀기
                  </AppText>
                  <ChevronIcon size={14} colorClassName="text-blue-600 dark:text-blue-400" />
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
