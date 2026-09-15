import { DIFFICULTY_SCORES } from "@gongmoa/core";
import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { loginHref, useCurrentHref } from "../login-link";
import { usePostDifficultyRating } from "../../queries/papers";

// 체감 난이도(웹 difficulty-rating.tsx, 설계서 §4.5 #21): 0.5 단계 막대를 골라 두고 "평가
// 제출하기"로 확정. 비로그인은 블러 + 로그인 CTA(제목은 항상 보여 "난이도 평가 칸"임을 알린다).
// 투표는 RLS insert(core postDifficultyRating), 문제지당 1회는 unique index 가 강제한다.

// 별점(=품질 평가) 느낌이 아니라 "쉬움 → 어려움"으로 읽히도록 초록~빨강 그라데이션을 쓴다.
function colorForScore(score: number) {
  if (score <= 1.5) return "bg-emerald-400";
  if (score <= 2.5) return "bg-lime-400";
  if (score <= 3.5) return "bg-yellow-400";
  if (score <= 4.5) return "bg-orange-500";
  return "bg-red-500";
}

function labelForScore(score: number) {
  if (score <= 1.5) return "매우 쉬움";
  if (score <= 2.5) return "쉬움";
  if (score <= 3.5) return "보통";
  if (score <= 4.5) return "어려움";
  return "매우 어려움";
}

// 평균은 0.5 단위와 정확히 일치하지 않을 수 있어 마커를 올릴 막대를 가장 가까운 0.5 단위로.
function nearestScoreStep(avg: number) {
  return Math.min(5, Math.max(1, Math.round(avg * 2) / 2));
}

export function DifficultyRating({
  paperId,
  averageScore,
  voteCount,
  loggedIn,
  myScore,
}: {
  paperId: string;
  averageScore: number | null;
  voteCount: number;
  loggedIn: boolean;
  // 이미 투표한 점수(캐시). 없으면 null.
  myScore: number | null;
}) {
  const current = useCurrentHref();
  const [selected, setSelected] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const post = usePostDifficultyRating(paperId);

  const voted = myScore !== null;
  const activeScore = myScore ?? selected ?? 0;
  const pending = post.isPending;

  function submit() {
    if (selected === null || !loggedIn) return;
    setMessage(null);
    post.mutate(selected, {
      onSuccess: () => setMessage("평가해주셔서 감사해요."),
      onError: (e) => setMessage(e instanceof Error ? e.message : "평가에 실패했어요."),
    });
  }

  return (
    <View className="gap-3 rounded-lg border border-zinc-200 p-4 dark:border-zinc-700">
      <AppText variant="sm" weight="medium">
        체감 난이도
      </AppText>

      <View className="relative">
        <View
          pointerEvents={loggedIn ? "auto" : "none"}
          accessibilityElementsHidden={!loggedIn}
          importantForAccessibility={loggedIn ? "auto" : "no-hide-descendants"}
          className="gap-3"
          // 비로그인은 집계·게이지를 흐린다(웹 blur-sm). Android 는 filter blur, iOS 는 아래 덮개가 가린다.
          style={loggedIn ? undefined : { filter: [{ blur: 4 }], opacity: 0.6 }}
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            {averageScore ? (
              <>
                평균{" "}
                <AppText variant="sm" weight="semibold" className="text-blue-600 dark:text-blue-400">
                  {averageScore.toFixed(1)}
                </AppText>{" "}
                / 5
              </>
            ) : (
              "평가 없음"
            )}{" "}
            · {voteCount}명 참여
          </AppText>

          <View className="gap-1 pt-8">
            <View className="flex-row items-end gap-1">
              {DIFFICULTY_SCORES.map((score, i) => {
                const isAvgMarker = averageScore !== null && score === nearestScoreStep(averageScore);
                return (
                  <View key={score} className="relative flex-1">
                    {isAvgMarker && (
                      <View pointerEvents="none" className="absolute left-0 right-0 items-center" style={{ bottom: 44 }}>
                        <AppText variant="10" weight="semibold" allowFontScaling={false} className="text-blue-600 dark:text-blue-400" numberOfLines={1}>
                          평균 체감 난이도
                        </AppText>
                        <AppText variant="10" allowFontScaling={false} className="text-blue-600 dark:text-blue-400">
                          ▼
                        </AppText>
                      </View>
                    )}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`난이도 ${score}점`}
                      accessibilityState={{ selected: selected === score, disabled: pending || voted }}
                      disabled={pending || voted}
                      onPress={() => setSelected(score)}
                      style={{ height: 14 + i * 3 }}
                      className={["w-full rounded-sm", score <= activeScore ? colorForScore(score) : "bg-zinc-200 dark:bg-zinc-700"].join(" ")}
                    />
                  </View>
                );
              })}
            </View>
            <View className="flex-row justify-between">
              <AppText variant="11" className="text-zinc-400 dark:text-zinc-600">
                쉬움
              </AppText>
              <AppText variant="11" className="text-zinc-400 dark:text-zinc-600">
                매우 어려움
              </AppText>
            </View>
          </View>

          <AppText variant="xs" className="text-zinc-600 dark:text-zinc-400">
            {voted
              ? `내가 준 점수: ${myScore} · ${labelForScore(myScore as number)}`
              : selected !== null
                ? `${selected} · ${labelForScore(selected)}`
                : "막대를 눌러 체감 난이도를 선택해주세요."}
          </AppText>

          {!voted && (
            <Button
              variant="neutralDark"
              label={pending ? "제출 중..." : "평가 제출하기"}
              disabled={selected === null}
              pending={pending}
              onPress={submit}
              className="self-start"
            />
          )}

          {message && (
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
              {message}
            </AppText>
          )}
        </View>

        {!loggedIn && (
          <View className="absolute inset-0 items-center justify-center gap-2 rounded-md bg-white/70 dark:bg-zinc-900/70">
            <AppText variant="sm" weight="medium" className="text-zinc-700 dark:text-zinc-300">
              난이도 평가는 로그인 후 참여할 수 있어요
            </AppText>
            <Button variant="neutralDark" label="로그인하기" onPress={() => router.push(loginHref(current))} />
          </View>
        )}
      </View>
    </View>
  );
}
