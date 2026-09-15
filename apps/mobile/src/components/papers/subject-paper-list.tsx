import { levelColor } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Check, ChevronRight, RotateCcw, Shuffle } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../app-text";
import { Button } from "../button";
import { themedIcon } from "../../theme/icons";

export type SubjectPaperItem = {
  paperId: string;
  title: string;
  level: string | null;
  attemptCount: number;
  latestScore: number | null;
  latestTotal: number | null;
  lastAttemptAt: string;
  unresolved: number;
  resolved: number;
};

// 과목 오답노트 "문제지별" 탭(웹 subject-paper-list.tsx, 설계서 §4.5 #25): 카드마다 "틀린 문제
// 다시 풀기", 체크로 여러 시험지를 골라 하단 고정 선택 바에서 합쳐 풀기. 하단 바는
// `bottom-4 z-30` 안의 `max-w-md rounded-2xl border p-2 shadow-lg` 카드 + safe-area.
// 복습 세션 생성(review-create UI)은 Phase 2 — 지금은 Alert 로 안내하고 바 마크업만 유지한다.
const ChevronIcon = themedIcon(ChevronRight);
const PHASE2_MESSAGE = "섞어풀기는 다음 단계에서 열려요";

export function SubjectPaperList({
  subjectSlug,
  papers,
  // 같은 탭에 섞어풀기 기록 섹션이 함께 실릴 때만 "시험지별" 소제목을 붙인다.
  heading,
}: {
  subjectSlug: string;
  papers: SubjectPaperItem[];
  heading?: string;
}) {
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(paperId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(paperId)) next.delete(paperId);
      else next.add(paperId);
      return next;
    });
  }

  // review-create 이식 전까지의 자리. paperIds 는 Phase 2 에서 createReviewFromPapers 로 간다.
  function launch(_paperIds: string[]) {
    Alert.alert(PHASE2_MESSAGE);
  }

  // 시험지가 2장 이상일 때만 "합쳐 풀기"가 의미 있어, 체크·안내를 그때만 노출한다.
  const multiSelectable = papers.length > 1;

  return (
    <View className={["gap-3", selected.size > 0 ? "pb-24" : ""].join(" ")}>
      {heading && (
        <View className="flex-row items-center justify-between">
          <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
            {heading}
          </AppText>
          <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
            {papers.length}장
          </AppText>
        </View>
      )}

      {papers.map((p) => {
        const pctLabel =
          p.latestScore != null && p.latestTotal ? `${Math.round((p.latestScore / p.latestTotal) * 100)}점` : null;
        const checked = selected.has(p.paperId);
        const total = p.resolved + p.unresolved;
        const resolvedPct = total > 0 ? Math.round((p.resolved / total) * 100) : 0;
        const cleared = p.unresolved === 0;
        return (
          <View
            key={p.paperId}
            className={[
              "gap-3 rounded-xl border p-4",
              checked
                ? "border-blue-400 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/20"
                : "border-zinc-200 dark:border-zinc-700",
            ].join(" ")}
          >
            <View className="flex-row items-start gap-2.5">
              {multiSelectable && (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel="시험지 선택"
                  accessibilityState={{ checked }}
                  onPress={() => toggle(p.paperId)}
                  hitSlop={8}
                  className={[
                    "mt-1 h-4 w-4 shrink-0 items-center justify-center rounded border",
                    checked ? "border-blue-600 bg-blue-600" : "border-zinc-400 bg-white dark:bg-zinc-900",
                  ].join(" ")}
                >
                  {checked && <Check size={12} color="#ffffff" />}
                </Pressable>
              )}
              <Pressable
                accessibilityRole="link"
                onPress={() => router.push(`/mypage/wrong-notes/${subjectSlug}/${p.paperId}` as Href)}
                className="min-w-0 flex-1 flex-row items-start gap-2"
              >
                <View className="min-w-0 flex-1 gap-3">
                  <View className="flex-row items-center gap-2">
                    {p.level && (
                      <View className={["shrink-0 rounded px-1.5 py-0.5", levelColor(p.level)].join(" ")}>
                        <AppText variant="11" weight="bold" allowFontScaling={false} className={levelColor(p.level)}>
                          {p.level}
                        </AppText>
                      </View>
                    )}
                    <AppText weight="semibold" className="min-w-0 flex-1 leading-snug" pretty>
                      {p.title}
                    </AppText>
                  </View>

                  {total > 0 && (
                    <View>
                      <View className="mb-1.5 flex-row items-center justify-between">
                        <AppText variant="xs" weight="semibold" className="text-zinc-600 dark:text-zinc-300">
                          극복 {p.resolved} / {total}문항
                        </AppText>
                        {cleared ? (
                          <AppText variant="xs" weight="semibold" className="text-emerald-600 dark:text-emerald-400">
                            모두 극복 🎉
                          </AppText>
                        ) : (
                          <AppText variant="xs" weight="semibold" className="text-red-600 dark:text-red-400">
                            남은 오답 {p.unresolved}
                          </AppText>
                        )}
                      </View>
                      <View className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                        <View className="h-full rounded-full bg-emerald-500" style={{ width: `${resolvedPct}%` }} />
                      </View>
                    </View>
                  )}

                  <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
                    <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
                      회독{" "}
                      <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
                        {p.attemptCount}회
                      </AppText>
                    </AppText>
                    {pctLabel && (
                      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
                        최근 점수{" "}
                        <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
                          {pctLabel}
                        </AppText>
                      </AppText>
                    )}
                  </View>
                </View>
                <ChevronIcon size={16} colorClassName="text-zinc-300 dark:text-zinc-700" />
              </Pressable>
            </View>

            <Button
              label={cleared ? "틀렸던 문제 복습하기" : "틀린 문제 다시 풀기"}
              icon={<RotateCcw size={15} color="#ffffff" />}
              onPress={() => launch([p.paperId])}
              className="rounded-lg py-2.5"
            />
          </View>
        );
      })}

      {multiSelectable && selected.size === 0 && (
        <AppText variant="xs" className="mt-1 text-center text-zinc-400 dark:text-zinc-500">
          여러 시험지를 체크하면 합쳐서 한 번에 풀 수 있어요
        </AppText>
      )}

      {/* 여러 시험지 선택 → 합쳐 풀기(하단 고정 선택 바, z-30 bottom-4 + safe-area). */}
      {selected.size > 0 && (
        <View pointerEvents="box-none" style={{ bottom: insets.bottom + 16 }} className="absolute inset-x-0 z-30 items-center px-4">
          <View className="w-full max-w-md flex-row items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <Pressable
              accessibilityRole="button"
              onPress={() => setSelected(new Set())}
              className="shrink-0 rounded-lg px-3 py-2 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <AppText variant="sm" weight="medium" className="text-zinc-500 dark:text-zinc-400">
                해제
              </AppText>
            </Pressable>
            <Button
              label={`선택한 ${selected.size}개 시험지 합쳐 풀기`}
              icon={<Shuffle size={15} color="#ffffff" />}
              onPress={() => launch([...selected])}
              className="flex-1 rounded-lg py-2.5"
            />
          </View>
        </View>
      )}
    </View>
  );
}
