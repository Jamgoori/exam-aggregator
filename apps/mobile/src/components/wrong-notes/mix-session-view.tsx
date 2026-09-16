import { examTypeFilledColor, levelColor, type ReviewHistoryMixNoteQuestion } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { RotateCcw, Shuffle } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { WrongNoteFilterChip } from "./filter-chip";
import { MemoEditor } from "./memo-editor";
import { WrongNoteLegend, WrongNoteQuestionCard, type WrongNoteCardRow } from "./wrong-note-question-card";
import { WrongNoteMarkActions, WrongNoteUndoToast } from "./wrong-note-mark-actions";
import { AppText } from "../app-text";
import { Button } from "../button";
import { useCreateReviewSession } from "../../queries/wrong-notes";

// "9월 5일 섞어풀기" 기록 화면 본문(웹 mix-session-view.tsx, 설계서 §4.5 #25). 기본은 그 세션에서
// 틀린 문항만(오답노트답게), 칩으로 전체 문항까지 볼 수 있다. 문항 카드는 과목 오답노트와 같은
// 것을 쓰므로 해설·메모·다시 볼 문제 체크·삭제가 그대로 붙는다.
//
// 정답·해설은 EF review-history { view:"mix-note" } 응답에 이미 실려 온다(프리미엄이면 본문,
// 아니면 explanationLocked) — 이 화면은 따로 묻지 않는다. 그 응답은 메모리 전용 쿼리다(§6.5).
type Filter = "wrong" | "all";

function toRow(q: ReviewHistoryMixNoteQuestion): WrongNoteCardRow {
  return {
    questionNumber: q.questionNumber,
    selectedChoice: q.selectedChoice,
    correctChoice: q.correctChoice,
    choiceCount: q.choiceCount,
    explanation: q.explanation,
    explanationLocked: q.explanationLocked,
    wrongCount: q.isCorrect ? undefined : q.wrongCount,
    resolved: q.isCorrect ? undefined : q.resolved,
  };
}

export function MixSessionView({
  subjectSlug,
  questions,
  wrongCount,
  resolvedCount,
  lockNext,
}: {
  subjectSlug: string;
  questions: ReviewHistoryMixNoteQuestion[];
  wrongCount: number;
  resolvedCount: number;
  lockNext: string;
}) {
  const [filter, setFilter] = useState<Filter>(wrongCount > 0 ? "wrong" : "all");
  const [error, setError] = useState<string | null>(null);
  const retry = useCreateReviewSession();

  // 다시 볼 문제 체크·완전 삭제는 서버 왕복 없이 즉시 반영. 키는 `${paperId}#${qnum}`.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.pinned).map((q) => `${q.paperId}#${q.questionNumber}`)),
  );
  const [deletedKeys, setDeletedKeys] = useState<Set<string>>(new Set());
  const [lastDeleted, setLastDeleted] = useState<{ key: string; paperId: string; questionNumber: number } | null>(null);
  // UndoToast 의 8초 타이머는 onDismiss 참조가 바뀌면 다시 걸린다 — 안정 참조로 둔다.
  const dismissUndo = useCallback(() => setLastDeleted(null), []);

  const visible = useMemo(() => {
    const list = questions.filter((q) => !deletedKeys.has(`${q.paperId}#${q.questionNumber}`));
    return filter === "wrong" ? list.filter((q) => !q.isCorrect) : list;
  }, [questions, deletedKeys, filter]);

  // 웹은 서버 액션 createRetryFromMix({sessionId}) 로 세션에서 틀린 문항을 서버가 직접 읽는다.
  // 앱에는 그 통로(EF mix-create {action:"retry"})가 아직 없어 EF review-create 의 items 분기를
  // 쓴다 — 여기서 넘기는 (paperId, questionNumber) 는 review_session_items 행 그대로이고
  // (getMixSessionWrongNote 가 그 행에서 만든다), 섞어풀기 채점이 같은 키로
  // user_question_status 를 쓰므로 서버의 filterQuestionsAnsweredByUser 를 전부 통과한다 =
  // createRetryFromMixSession 과 같은 문항 구성·같은 순서(position).
  function retryWrong() {
    if (retry.isPending || wrongCount === 0) return;
    setError(null);
    const items = questions
      .filter((q) => !q.isCorrect)
      .sort((a, b) => a.position - b.position)
      .map((q) => ({ paperId: q.paperId, questionNumber: q.questionNumber }));
    retry.mutate(
      { items },
      {
        onSuccess: (sessionId) => router.push(`/mypage/wrong-notes/${subjectSlug}/review/${sessionId}` as Href),
        onError: (e) => setError(e instanceof Error ? e.message : "다시 풀기를 시작하지 못했어요."),
      },
    );
  }

  return (
    <View className="gap-4">
      <View className="gap-2">
        {wrongCount > 0 && (
          <Button
            label={retry.isPending ? "준비 중..." : `틀린 ${wrongCount}문항 다시 풀기`}
            icon={<RotateCcw size={16} color="#ffffff" />}
            pending={retry.isPending}
            onPress={retryWrong}
            className="w-full py-3"
          />
        )}
        <Button
          variant="tinted"
          label="새로 섞어풀기"
          icon={<Shuffle size={16} color="#1d4ed8" />}
          accessibilityRole="link"
          onPress={() => router.push(`/subjects/${subjectSlug}/mix` as Href)}
          className="w-full py-3"
          textClassName="text-sm font-bold"
        />
      </View>
      {error && (
        <AppText variant="xs" className="-mt-2 text-center text-red-600 dark:text-red-400" pretty>
          {error}
        </AppText>
      )}

      <View className="flex-row flex-wrap items-center gap-2">
        <WrongNoteFilterChip
          label={`틀린 문항 ${wrongCount}`}
          active={filter === "wrong"}
          disabled={wrongCount === 0}
          onPress={() => setFilter("wrong")}
        />
        <WrongNoteFilterChip label={`전체 ${questions.length}문항`} active={filter === "all"} onPress={() => setFilter("all")} />
      </View>

      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
        {filter === "wrong"
          ? `이 섞어풀기에서 틀린 문제예요. 그 뒤 다른 곳에서 맞힌 문제는 극복으로 표시돼요 (극복 ${resolvedCount} / ${wrongCount}).`
          : "이 섞어풀기에 나온 문제 전체예요. 답 표시는 그때 고른 답 기준이에요."}
      </AppText>

      {visible.length === 0 ? (
        <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
          {filter === "wrong" ? "이 섞어풀기에서는 틀린 문제가 없어요. 완벽했어요! 🎉" : "보여줄 문항이 없어요."}
        </AppText>
      ) : (
        <>
          <WrongNoteLegend />
          <View className="gap-5">
            {visible.map((q) => {
              const key = `${q.paperId}#${q.questionNumber}`;
              return (
                <View key={q.position} className="gap-1.5">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <AppText variant="xs" weight="semibold" className="shrink-0 text-zinc-400 dark:text-zinc-600">
                      {q.position + 1}번
                    </AppText>
                    {q.examTypeName && (
                      <View className={["shrink-0 rounded px-1.5 py-0.5", examTypeFilledColor(q.examTypeName)].join(" ")}>
                        <AppText
                          variant="11"
                          weight="bold"
                          allowFontScaling={false}
                          className={examTypeFilledColor(q.examTypeName)}
                        >
                          {q.examTypeName}
                        </AppText>
                      </View>
                    )}
                    {q.paperLevel && (
                      <View className={["shrink-0 rounded px-1.5 py-0.5", levelColor(q.paperLevel)].join(" ")}>
                        <AppText variant="11" weight="bold" allowFontScaling={false} className={levelColor(q.paperLevel)}>
                          {q.paperLevel}
                        </AppText>
                      </View>
                    )}
                    <AppText variant="xs" weight="medium" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400">
                      {q.paperTitle} {q.questionNumber}번
                    </AppText>
                    {q.isCorrect && (
                      <View className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 dark:bg-emerald-950/30">
                        <AppText variant="xs" weight="medium" className="text-emerald-700 dark:text-emerald-400">
                          정답
                        </AppText>
                      </View>
                    )}
                  </View>
                  <WrongNoteQuestionCard
                    rows={[toRow(q)]}
                    images={q.images}
                    explanationLockNext={lockNext}
                    paperId={q.paperId}
                    reportContext="explanation"
                    renderRowActions={
                      q.isCorrect
                        ? undefined
                        : (questionNumber) => (
                            <WrongNoteMarkActions
                              paperId={q.paperId}
                              questionNumber={questionNumber}
                              pinned={pinnedKeys.has(key)}
                              onPinnedChange={(p) =>
                                setPinnedKeys((prev) => {
                                  const next = new Set(prev);
                                  if (p) next.add(key);
                                  else next.delete(key);
                                  return next;
                                })
                              }
                              onDeleted={() => {
                                setDeletedKeys((prev) => new Set(prev).add(key));
                                setLastDeleted({ key, paperId: q.paperId, questionNumber });
                              }}
                              onDeleteFailed={() => {
                                setDeletedKeys((prev) => {
                                  const next = new Set(prev);
                                  next.delete(key);
                                  return next;
                                });
                                setLastDeleted((cur) => (cur?.key === key ? null : cur));
                              }}
                            />
                          )
                    }
                  />
                  {!q.isCorrect && (
                    <View className="rounded-xl border border-zinc-100 dark:border-zinc-700/70">
                      <MemoEditor paperId={q.paperId} questionNumber={q.questionNumber} initialMemo={q.memo} />
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        </>
      )}

      {lastDeleted && (
        <WrongNoteUndoToast
          key={lastDeleted.key}
          paperId={lastDeleted.paperId}
          questionNumber={lastDeleted.questionNumber}
          onRestored={() => {
            setDeletedKeys((prev) => {
              const next = new Set(prev);
              next.delete(lastDeleted.key);
              return next;
            });
            setLastDeleted(null);
          }}
          onDismiss={dismissUndo}
        />
      )}
    </View>
  );
}
