import { mixSessionTitle } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { RotateCcw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText } from "../app-text";
import { useExitGuard } from "../cbt/exit-guard";
import { QuestionImage } from "../question-image";
import { themedIcon } from "../../theme/icons";
import { handleEdgeError } from "../../lib/edge";
import { clearReviewDraft } from "../../lib/review-draft";
import { useCreateReviewFromWrong, type ReviewItem, type ReviewSessionDetail } from "../../queries/review";
import { isMixSession } from "./review-solver";
import { ReviewScheduleSection } from "./review-schedule-section";

// 복습·섞어풀기 채점 결과(웹 review-solver.tsx 의 ReviewResult 1:1, 설계서 §4.5 #23 "결과 화면").
// 점수 + 문항별 정오·정답·출처 공개. 해설은 여기 없다 — 틀린 문제를 해설과 같이 보려면
// 오답노트로 간다(그래서 mix 는 배너로 기록 위치를 바로 알린다).
const RetryIcon = themedIcon(RotateCcw);

export function ReviewResult({
  view,
  backHref,
  subjectSlug,
}: {
  view: ReviewSessionDetail;
  backHref: string;
  subjectSlug: string;
}) {
  const insets = useSafeAreaInsets();
  const [error, setError] = useState<string | null>(null);
  const createReview = useCreateReviewFromWrong();

  const mix = isMixSession(view);
  const correct = view.score ?? 0;
  const total = view.total;
  const wrong = total - correct;
  const pct = total > 0 ? Math.round((correct / total) * 100) : 0;

  const items = useMemo(() => [...view.items].sort((a, b) => a.position - b.position), [view.items]);

  const wrongItems = useMemo(
    () =>
      items
        .filter((it) => it.isCorrect === false && it.paperId && it.questionNumber != null)
        .map((it) => ({ paperId: it.paperId as string, questionNumber: it.questionNumber as number })),
    [items],
  );

  // 채점이 끝난 세션의 임시 저장분은 필요 없다(웹 clearDraftAnswers). 다른 기기에서 채점하고
  // 이 화면으로 바로 들어온 경우까지 여기서 정리한다 — 안 지우면 kv 에 계속 쌓인다.
  useEffect(() => {
    void clearReviewDraft(view.sessionId);
  }, [view.sessionId]);

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace(backHref as Href);
  }, [backHref]);
  // 채점이 끝났으니 붙잡지 않는다(active=false) — Android 뒤로가기만 여기서 받는다.
  useExitGuard(false, leave);

  const pending = createReview.isPending;

  const retryWrong = useCallback(async () => {
    if (pending || wrongItems.length === 0) return;
    setError(null);
    try {
      const sessionId = await createReview.mutateAsync(wrongItems);
      // 방금 끝난 결과 화면은 다시 볼 일이 없다(같은 주소로 언제든 열린다) — 쌓지 않고 바꾼다.
      router.replace(`/mypage/wrong-notes/${subjectSlug}/review/${sessionId}` as Href);
    } catch (e) {
      const handled = await handleEdgeError(e, {
        next: `/mypage/wrong-notes/${subjectSlug}/review/${view.sessionId}`,
      });
      if (handled.redirected) return;
      setError(handled.message || "다시 풀기를 시작하지 못했어요.");
    }
    // mutateAsync 는 안정 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, wrongItems, subjectSlug, view.sessionId]);

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}
      contentContainerClassName="w-full max-w-2xl gap-6 self-center px-4 py-10"
    >
      <View className="items-center gap-3">
        <View className="h-28 w-28 items-center justify-center rounded-full border-8 border-blue-600 border-r-zinc-200 dark:border-r-zinc-700">
          <AppText variant="2xl" weight="bold" tabular>
            {correct}
            <AppText variant="base" className="text-zinc-400" tabular>
              /{total}
            </AppText>
          </AppText>
          <AppText variant="xs" className="text-zinc-500" tabular>
            정답률 {pct}%
          </AppText>
        </View>
        {/* 하나도 못 넘겼을 때 "🎉 0문항 극복"으로 조롱하지 않도록 톤을 나눈다(웹과 같은 2종). */}
        {correct > 0 ? (
          <View className="flex-row items-center gap-2">
            <View className="rounded-full bg-emerald-100 px-2.5 py-0.5 dark:bg-emerald-950/30">
              <AppText variant="xs" weight="medium" className="text-emerald-700 dark:text-emerald-400">
                🎉 {correct}문항 {mix ? "정답" : "극복"}
              </AppText>
            </View>
            {wrong > 0 && (
              <View className="rounded-full bg-red-100 px-2.5 py-0.5 dark:bg-red-950/30">
                <AppText variant="xs" weight="medium" className="text-red-700 dark:text-red-400">
                  {wrong}문항 {mix ? "오답" : "아직"}
                </AppText>
              </View>
            )}
          </View>
        ) : (
          <AppText variant="sm" weight="medium" className="text-center text-zinc-600 dark:text-zinc-400" pretty>
            {mix
              ? "이번엔 다 틀렸어요. 오답노트에서 해설을 보고 다시 풀어봐요 💪"
              : "아직 못 넘겼어요. 해설을 보고 한 번 더 도전해요 💪"}
          </AppText>
        )}
      </View>

      {/* 기출 섞어풀기는 채점과 동시에 오답노트에 날짜 이름으로 남는다. 결과 화면에는 해설이
          없으므로 틀린 문제를 해설과 같이 보려면 그 기록으로 가야 한다는 걸 여기서 알린다.
          (기록 화면 `…/mix/[sessionId]` 자체는 Phase 3 — 그때 이 링크가 살아난다.) */}
      {mix && (
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push(`/mypage/wrong-notes/${subjectSlug}/mix/${view.sessionId}` as Href)}
          className="flex-row items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 dark:border-emerald-900/50 dark:bg-emerald-950/20"
        >
          <AppText variant="sm" className="min-w-0 flex-1 text-emerald-900 dark:text-emerald-200" pretty>
            오답노트에{" "}
            <AppText variant="sm" weight="semibold" className="text-emerald-900 dark:text-emerald-200">
              “{mixSessionTitle(view.createdAt)}”
            </AppText>
            {wrong > 0 ? "로 저장했어요. 틀린 문제를 해설과 함께 볼 수 있어요." : "로 저장했어요."}
          </AppText>
          <AppText variant="sm" weight="semibold" className="shrink-0 text-emerald-700 dark:text-emerald-300">
            보기 →
          </AppText>
        </Pressable>
      )}

      {/* 틀린 문항만 다시 풀기. mix 는 웹이 createRetryFromMix({sessionId}) 를 쓰는데(세션에서
          틀린 문항을 서버가 직접 읽는다), 앱 통로인 EF mix-create {action:"retry"} 가 아직 없다
          → Phase 3. items 로 대신 부르면 filterQuestionsAnsweredByUser 가 형제 문제지에 상태가
          기록된 문항을 걸러내 웹과 다른 문항 구성이 나올 수 있어 버튼을 그리지 않는다. */}
      {!mix && wrongItems.length > 0 && (
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: pending }}
          disabled={pending}
          onPress={() => void retryWrong()}
          className={[
            "w-full flex-row items-center justify-center gap-1.5 rounded-xl bg-blue-600 py-3 active:bg-blue-700",
            pending ? "opacity-60" : "",
          ].join(" ")}
        >
          <RetryIcon size={16} colorClassName="text-white" />
          <AppText variant="sm" weight="bold" className="text-white">
            {pending ? "준비 중..." : `틀린 ${wrongItems.length}문항만 다시 풀기`}
          </AppText>
        </Pressable>
      )}
      {error && (
        <AppText variant="xs" className="-mt-3 text-center text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      {/* 채점 직후가 스케줄을 이해시키기 제일 좋은 자리다(무료 사용자에게는 아무것도 안 뜬다). */}
      <ReviewScheduleSection view={view} />

      <Pressable
        accessibilityRole="button"
        onPress={leave}
        className="w-full rounded-xl bg-zinc-100 py-3 active:bg-zinc-200 dark:bg-zinc-800 dark:active:bg-zinc-700"
      >
        <AppText variant="sm" weight="bold" className="text-center text-zinc-700 dark:text-zinc-300">
          오답노트로 돌아가기
        </AppText>
      </Pressable>

      <View className="gap-4">
        {items.map((it) => (
          <ResultCard key={it.position} item={it} mix={mix} />
        ))}
      </View>
    </ScrollView>
  );
}

function ResultCard({ item, mix }: { item: ReviewItem; mix: boolean }) {
  return (
    <View className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
      <View className="flex-row items-center justify-between gap-2 border-b border-zinc-100 bg-zinc-50 px-4 py-2 dark:border-zinc-700 dark:bg-zinc-800/50">
        <AppText variant="xs" weight="medium" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400" numberOfLines={1}>
          {item.position + 1}번{item.paperTitle ? ` · ${item.paperTitle} ${item.questionNumber}번` : ""}
        </AppText>
        {item.isCorrect ? (
          <View className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-950/30">
            <AppText variant="xs" weight="medium" className="text-emerald-700 dark:text-emerald-400">
              {mix ? "정답" : "극복"}
            </AppText>
          </View>
        ) : (
          <View className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 dark:bg-red-950/30">
            <AppText variant="xs" weight="medium" className="text-red-700 dark:text-red-400">
              오답
            </AppText>
          </View>
        )}
      </View>

      {item.images.length > 0 && (
        <View>
          {item.images.map((src, i) => (
            <QuestionImage key={src} path={src} accessibilityLabel={`${item.position + 1}번 이미지 ${i + 1}`} />
          ))}
        </View>
      )}

      <View className="flex-row flex-wrap items-center gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
        {Array.from({ length: item.choiceCount }, (_, c) => c + 1).map((choice) => {
          const isCorrect = item.correctChoice === choice;
          const isMyWrong = !isCorrect && item.selectedChoice === choice;
          const box = isCorrect
            ? "bg-emerald-500"
            : isMyWrong
              ? "bg-red-500"
              : "bg-zinc-100 dark:bg-zinc-800";
          const text = isCorrect || isMyWrong ? "text-white" : "text-zinc-500 dark:text-zinc-500";
          return (
            <View
              key={choice}
              accessibilityLabel={
                isCorrect ? `${choice}번 정답` : isMyWrong ? `${choice}번 내가 고른 오답` : undefined
              }
              className={["h-9 w-9 items-center justify-center rounded-full", box].join(" ")}
            >
              <AppText variant="sm" weight="semibold" className={text} allowFontScaling={false}>
                {choice}
              </AppText>
            </View>
          );
        })}
        {item.selectedChoice === null && (
          <View className="ml-1 rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
            <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-500">
              풀지 않음
            </AppText>
          </View>
        )}
        {/* Phase 3: "찍었어요"(GuessedButton, 맞힌 문항에만·단방향) — EF review-guessed(§6.7 #11)가
            아직 없어 아무것도 그리지 않는다. 눌러도 안 되는 버튼을 두면 "찍었다"가 기록된 줄 알고
            넘어가 복습 간격이 실제와 달라진다. */}
      </View>
    </View>
  );
}
