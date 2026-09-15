import { CONSONANTS, initialConsonant, type Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { SubjectBookmarkButton } from "./subject-bookmark-button";
import { AppText } from "../app-text";
import { CenterModal } from "../sheet";

// 과목 초성 색인(웹 subject-index-tabs.tsx, 설계서 §4.5 #4 ConsonantTabs): 맨 앞 한능검 알약
// 탭(`h-8 px-3 rounded-full border`, kheHref 로 곧장 이동) + 초성 원형 14개(`h-8 w-8`, 가로
// 스크롤·스크롤바 숨김) → 탭 시 CenterModal(bg-black/40, max-h 70% max-w-md rounded-xl p-5,
// 제목 `'ㄱ' 과목`, "닫기")에 해당 초성 과목 2열 그리드 + SubjectBookmarkButton(sm).
// 활성 상태·"전체" 항목 없음.

// 한국사능력검정시험 — 웹 lib/korean-history-exam.ts 와 동일(Phase 2 에 core 로 통일).
// 공무원 "한국사" 과목과 섞지 않는다: 전용 과목 행은 초성 목록에서 빼고 전용 탭 하나로 들어간다.
export const KHE_SUBJECT_SLUG = "korean-history-exam";
export const KHE_EXAM_TYPE_NAME = "한능검";
export const KHE_LEVEL = "심화";
export const KHE_TAB_LABEL = "한능검";

/** 한능검 탭이 가는 곳. 웹은 시험 허브(/exams/한능검-심화)지만 /exams 는 Phase 2 까지 라우트가 없어
 *  홈 시험 카드(home/past-questions.tsx)처럼 같은 필터의 문제지 목록으로 보낸다. */
export function kheHref(): Href {
  return { pathname: "/papers", params: { type: KHE_EXAM_TYPE_NAME, level: KHE_LEVEL } } as Href;
}

/** 과목 초성 목록에서 한능검 전용 과목을 뺀다. */
export function withoutKheSubject<T extends { slug: string }>(subjects: T[]): T[] {
  return subjects.filter((s) => s.slug !== KHE_SUBJECT_SLUG);
}

export function SubjectIndexTabs({
  subjects,
  onToggle,
}: {
  subjects: Subject[];
  // /papers 처럼 즐겨찾기 상태로 목록을 거르는 화면이 곧바로 따라가기 위한 알림.
  onToggle?: (subjectId: string, bookmarked: boolean) => void;
}) {
  const [active, setActive] = useState<string | null>(null);

  const filtered = active ? withoutKheSubject(subjects).filter((s) => initialConsonant(s.name) === active) : [];

  const circle =
    "h-8 items-center justify-center rounded-full border border-zinc-200 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-700 dark:active:bg-blue-950/40";

  return (
    <>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-4 border-t border-zinc-100 dark:border-zinc-700"
        contentContainerClassName="flex-row gap-2 px-4 pt-3 pb-1"
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(kheHref())}
          className={[circle, "bg-white px-3 dark:bg-transparent"].join(" ")}
        >
          <AppText variant="sm" weight="semibold" className="text-zinc-600 dark:text-zinc-400">
            {KHE_TAB_LABEL}
          </AppText>
        </Pressable>
        {CONSONANTS.map((c) => (
          <Pressable
            key={c}
            accessibilityRole="button"
            accessibilityLabel={`${c} 과목`}
            onPress={() => setActive(c)}
            className={[circle, "w-8"].join(" ")}
          >
            <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
              {c}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <CenterModal visible={active !== null} onClose={() => setActive(null)} size="md">
        <View className="mb-3 flex-row items-center justify-between">
          <AppText weight="semibold">&apos;{active}&apos; 과목</AppText>
          <Pressable accessibilityRole="button" onPress={() => setActive(null)} hitSlop={8}>
            <AppText variant="sm" className="text-zinc-400 dark:text-zinc-600">
              닫기
            </AppText>
          </Pressable>
        </View>
        {filtered.length === 0 ? (
          <AppText variant="sm" className="py-6 text-center text-zinc-500 dark:text-zinc-500">
            해당하는 과목이 없어요.
          </AppText>
        ) : (
          <ScrollView className="min-h-0 shrink" contentContainerClassName="flex-row flex-wrap gap-2">
            {filtered.map((s) => (
              <View
                key={s.id}
                className="w-[48%] flex-row items-center gap-1 rounded-lg border border-zinc-200 py-1 pl-3 pr-1.5 dark:border-zinc-700"
              >
                <Pressable
                  accessibilityRole="link"
                  onPress={() => {
                    setActive(null);
                    router.push(`/subjects/${s.slug}` as Href);
                  }}
                  className="min-w-0 flex-1 py-1"
                >
                  <AppText variant="sm" className="text-center" numberOfLines={1}>
                    {s.name}
                  </AppText>
                </Pressable>
                <SubjectBookmarkButton subjectId={s.id} size="sm" onToggled={(next) => onToggle?.(s.id, next)} />
              </View>
            ))}
          </ScrollView>
        )}
      </CenterModal>
    </>
  );
}
