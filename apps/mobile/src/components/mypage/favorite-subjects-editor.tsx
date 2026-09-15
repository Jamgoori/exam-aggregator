import { getSubjectShortName, type Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Pencil, Star, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { AppText } from "../app-text";
import { Input } from "../input";
import { CenterModal } from "../sheet";
import { useMyBookmarkedSubjectIds, useToggleSubjectBookmark } from "../../queries/bookmarks";
import { useIsDark } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 마이페이지 즐겨찾기 탭의 "즐겨찾는 과목" 편집 영역(웹 favorite-subjects-editor.tsx, 설계서 §4.5
// #19). 즐겨찾은 과목을 칩으로 보여주고, "편집"을 누르면 전체 과목 목록 모달에서 별을 눌러
// 추가/제거한다. 상태 정본은 ['me',u,'subject-bookmarks'] 캐시(낙관적 업데이트·되돌림은
// queries/bookmarks.ts) — 과목 페이지·/papers 의 "즐겨찾기한 과목만 보기"가 곧바로 따라간다.
const PencilIcon = themedIcon(Pencil);
const CloseIcon = themedIcon(X);

export function FavoriteSubjectsEditor({ subjects }: { subjects: Subject[] }) {
  const { set } = useMyBookmarkedSubjectIds();
  const toggle = useToggleSubjectBookmark();
  const [editorOpen, setEditorOpen] = useState(false);
  const [query, setQuery] = useState("");
  const dark = useIsDark();

  const favorites = useMemo(() => subjects.filter((s) => set.has(s.id)), [subjects, set]);
  const filtered = useMemo(() => {
    const q = query.trim();
    return q ? subjects.filter((s) => s.name.includes(q)) : subjects;
  }, [subjects, query]);

  function onToggle(subjectId: string) {
    toggle.mutate({ subjectId, next: !set.has(subjectId) });
  }

  const error = toggle.isError ? (toggle.error instanceof Error ? toggle.error.message : "즐겨찾기에 실패했어요.") : null;

  return (
    <View className="gap-3">
      <View className="flex-row items-center justify-between gap-2">
        <View className="flex-row items-center gap-2">
          <Star size={18} color="#ffb900" />
          <AppText variant="lg" weight="semibold">
            즐겨찾는 과목 ({favorites.length})
          </AppText>
        </View>
        <Pressable
          accessibilityRole="button"
          onPress={() => setEditorOpen(true)}
          className="flex-row items-center gap-1 rounded-full border border-zinc-200 px-3 py-1 active:border-blue-300 dark:border-zinc-700 dark:active:border-blue-700"
        >
          <PencilIcon size={12} colorClassName="text-zinc-600 dark:text-zinc-400" />
          <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-400">
            편집
          </AppText>
        </Pressable>
      </View>
      {error && (
        <AppText variant="xs" className="text-red-600 dark:text-red-400" accessibilityRole="alert">
          {error}
        </AppText>
      )}
      {favorites.length === 0 ? (
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" pretty>
          아직 즐겨찾는 과목이 없어요. 편집을 눌러 과목을 추가해보세요.
        </AppText>
      ) : (
        <View className="flex-row flex-wrap gap-2">
          {favorites.map((s) => {
            const short = getSubjectShortName(s.name);
            return (
              <View key={s.id} className="flex-row items-center gap-1 rounded-full border border-zinc-200 py-1 pl-3 pr-1.5 dark:border-zinc-700">
                <Pressable accessibilityRole="link" onPress={() => router.push(`/subjects/${s.slug}` as Href)} hitSlop={4}>
                  <AppText variant="sm">{short}</AppText>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${short} 즐겨찾기 해제`}
                  onPress={() => onToggle(s.id)}
                  hitSlop={4}
                  className="h-5 w-5 items-center justify-center rounded-full active:bg-zinc-100 dark:active:bg-zinc-800"
                >
                  <CloseIcon size={13} colorClassName="text-zinc-400 dark:text-zinc-600" />
                </Pressable>
              </View>
            );
          })}
        </View>
      )}

      <CenterModal visible={editorOpen} onClose={() => setEditorOpen(false)} size="md">
        <View className="mb-3 flex-row items-center justify-between">
          <AppText weight="semibold">즐겨찾는 과목 편집</AppText>
          <Pressable accessibilityRole="button" accessibilityLabel="닫기" onPress={() => setEditorOpen(false)} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-400 dark:text-zinc-600">
              닫기
            </AppText>
          </Pressable>
        </View>
        <Input
          value={query}
          onChangeText={setQuery}
          placeholder="과목 이름 검색"
          autoCorrect={false}
          accessibilityLabel="과목 이름 검색"
          className="mb-3 border-zinc-200 focus:border-blue-400"
        />
        <ScrollView className="min-h-0 shrink" keyboardShouldPersistTaps="handled">
          {filtered.length === 0 ? (
            <AppText variant="sm" className="py-6 text-center text-zinc-500 dark:text-zinc-500">
              해당하는 과목이 없어요.
            </AppText>
          ) : (
            <View className="flex-row flex-wrap gap-2">
              {filtered.map((s) => {
                const bookmarked = set.has(s.id);
                const starColor = bookmarked ? (dark ? "#ffb900" : "#b45309") : dark ? "#9f9fa9" : "#52525c";
                return (
                  <Pressable
                    key={s.id}
                    accessibilityRole="button"
                    accessibilityState={{ selected: bookmarked }}
                    onPress={() => onToggle(s.id)}
                    className={[
                      "w-[48%] flex-row items-center justify-between gap-1.5 rounded-lg border px-3 py-2",
                      bookmarked
                        ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
                        : "border-zinc-200 active:border-blue-300 dark:border-zinc-700 dark:active:border-blue-700",
                    ].join(" ")}
                  >
                    <AppText
                      variant="sm"
                      numberOfLines={1}
                      className={["min-w-0 flex-1", bookmarked ? "text-amber-700 dark:text-amber-400" : "text-zinc-600 dark:text-zinc-400"].join(" ")}
                    >
                      {getSubjectShortName(s.name)}
                    </AppText>
                    <Star size={14} color={starColor} fill={bookmarked ? starColor : "none"} />
                  </Pressable>
                );
              })}
            </View>
          )}
        </ScrollView>
      </CenterModal>
    </View>
  );
}
