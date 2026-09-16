import { KST_TIME_ZONE } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight, Shuffle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// 오답노트 과목 화면과 섞어풀기 시작 화면이 함께 쓰는 섞어풀기 기록 카드 목록
// (웹 mix-session-list.tsx 1:1). 카드 하나가 세션 하나("9월 5일 섞어풀기")이고, 누르면 그
// 세션에서 틀린 문항·해설을 보는 기록 화면으로 간다.
const ShuffleIcon = themedIcon(Shuffle);
const ChevronIcon = themedIcon(ChevronRight);

export type MixSessionCard = {
  id: string;
  title: string;
  createdAt: string;
  score: number;
  total: number;
  wrongCount: number;
  resolvedCount: number;
};

export function MixSessionList({
  subjectSlug,
  sessions,
}: {
  subjectSlug: string;
  sessions: MixSessionCard[];
}) {
  if (sessions.length === 0) return null;
  return (
    <View className="gap-3">
      {sessions.map((s) => {
        const pct = s.total > 0 ? Math.round((s.score / s.total) * 100) : 0;
        const cleared = s.wrongCount > 0 && s.resolvedCount >= s.wrongCount;
        const remaining = Math.max(0, s.wrongCount - s.resolvedCount);
        const resolvedPct = s.wrongCount > 0 ? Math.round((s.resolvedCount / s.wrongCount) * 100) : 0;
        const time = new Date(s.createdAt).toLocaleTimeString("ko-KR", {
          timeZone: KST_TIME_ZONE,
          hour: "numeric",
          minute: "2-digit",
        });
        return (
          <Pressable
            key={s.id}
            accessibilityRole="link"
            onPress={() => router.push(`/mypage/wrong-notes/${subjectSlug}/mix/${s.id}` as Href)}
            className="gap-3 rounded-xl border border-zinc-200 p-4 active:border-blue-300 active:bg-blue-50/40 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/20"
          >
            <View className="flex-row items-start gap-2">
              <View className="min-w-0 flex-1 gap-3">
                <View className="flex-row flex-wrap items-center gap-2">
                  <View className="shrink-0 flex-row items-center gap-1 rounded bg-blue-100 px-1.5 py-0.5 dark:bg-blue-950/40">
                    <ShuffleIcon size={11} colorClassName="text-blue-700 dark:text-blue-300" />
                    <AppText
                      variant="11"
                      weight="bold"
                      allowFontScaling={false}
                      className="text-blue-700 dark:text-blue-300"
                    >
                      섞어풀기
                    </AppText>
                  </View>
                  <AppText weight="semibold" className="leading-snug">
                    {s.title}
                  </AppText>
                  <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
                    {time}
                  </AppText>
                </View>

                {s.wrongCount > 0 ? (
                  <View>
                    <View className="mb-1.5 flex-row items-center justify-between">
                      <AppText variant="xs" weight="semibold" className="text-zinc-600 dark:text-zinc-300">
                        극복 {s.resolvedCount} / {s.wrongCount}문항
                      </AppText>
                      {cleared ? (
                        <AppText variant="xs" weight="semibold" className="text-emerald-600 dark:text-emerald-400">
                          모두 극복 🎉
                        </AppText>
                      ) : (
                        <AppText variant="xs" weight="semibold" className="text-red-600 dark:text-red-400">
                          남은 오답 {remaining}
                        </AppText>
                      )}
                    </View>
                    <View className="h-2 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                      <View className="h-full rounded-full bg-emerald-500" style={{ width: `${resolvedPct}%` }} />
                    </View>
                  </View>
                ) : (
                  <AppText variant="xs" weight="semibold" className="text-emerald-600 dark:text-emerald-400">
                    전부 맞혔어요 🎉
                  </AppText>
                )}

                <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
                  점수{" "}
                  <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
                    {s.score}/{s.total} ({pct}점)
                  </AppText>
                </AppText>
              </View>
              <View className="mt-0.5 shrink-0">
                <ChevronIcon size={16} colorClassName="text-zinc-300 dark:text-zinc-700" />
              </View>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}
