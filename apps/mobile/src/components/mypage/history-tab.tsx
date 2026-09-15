import { applyExamTypeSubjectName, formatDuration, KST_TIME_ZONE, type MyAttemptRow } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight, Trophy } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { themedIcon } from "../../theme/icons";

// "내 시험 기록" 탭(웹 mypage/page.tsx HistoryTab:596): CBT 응시 이력 목록. 회차를 누르면 문제지
// 상세 대신 그 회차의 오답만 모아 보여주는 페이지(/mypage/attempts/[id])로 간다.
// 회독 번호는 core computeAttemptRounds(화면이 넘긴다).
const ChevronIcon = themedIcon(ChevronRight);

export function HistoryTab({ attempts, roundNumberByAttemptId }: { attempts: MyAttemptRow[]; roundNumberByAttemptId: Map<string, number> }) {
  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-2">
        <Trophy size={18} color="#fd9a00" />
        <AppText variant="lg" weight="semibold">
          내 시험 기록 ({attempts.length})
        </AppText>
      </View>
      {attempts.length === 0 ? (
        <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
          아직 CBT로 풀어본 문제가 없어요. 문제 상세 페이지에서 온라인 풀기를 눌러보세요.
        </AppText>
      ) : (
        <View>
          {attempts.map((a, i) => {
            const pct = a.total_questions > 0 ? Math.round((a.score / a.total_questions) * 100) : 0;
            const wrongCount = a.total_questions - a.score;
            const round = roundNumberByAttemptId.get(a.id);
            return (
              <Pressable
                key={a.id}
                accessibilityRole="link"
                onPress={() => router.push(`/mypage/attempts/${a.id}` as Href)}
                className={[
                  "gap-1 py-4 active:bg-zinc-50 dark:active:bg-zinc-800/50",
                  i > 0 ? "border-t border-zinc-100 dark:border-zinc-700" : "",
                ].join(" ")}
              >
                <View className="gap-0.5">
                  {a.exam_papers ? (
                    <AppText variant="sm" weight="medium" pretty>
                      {applyExamTypeSubjectName(a.exam_papers.title)}
                    </AppText>
                  ) : (
                    <AppText variant="sm" className="text-zinc-400 dark:text-zinc-600">
                      삭제된 문제
                    </AppText>
                  )}
                  <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
                    {new Date(a.created_at).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE })}
                    {a.duration_seconds != null && ` · ${formatDuration(a.duration_seconds)}`}
                  </AppText>
                </View>
                <View className="flex-row items-center gap-2">
                  {round != null && (
                    <View className="shrink-0 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
                      <AppText variant="xs" weight="medium" allowFontScaling={false} className="text-zinc-500 dark:text-zinc-500">
                        {round}회독
                      </AppText>
                    </View>
                  )}
                  <AppText variant="sm" weight="semibold" tabular>
                    {a.score}/{a.total_questions}
                  </AppText>
                  <AppText variant="xs" tabular className="text-zinc-400 dark:text-zinc-600">
                    ({pct}점)
                  </AppText>
                  <AppText
                    variant="xs"
                    weight="medium"
                    className={wrongCount > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
                  >
                    오답 {wrongCount}
                  </AppText>
                  <View className="ml-auto">
                    <ChevronIcon size={15} colorClassName="text-zinc-300 dark:text-zinc-700" />
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}
