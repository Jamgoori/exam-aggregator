import { examTypeFilledColor, levelColor, type ReviewHistoryMixNoteQuestion } from "@gongmoa/core";
import { Shuffle } from "lucide-react-native";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { WrongNoteFilterChip } from "./filter-chip";
import { MemoEditor } from "./memo-editor";
import { WrongNoteLegend, WrongNoteQuestionCard, type WrongNoteCardRow } from "./wrong-note-question-card";
import { WrongNoteMarkActions, type WrongNoteDeletions } from "./wrong-note-mark-actions";
import { AppText } from "../app-text";
import { Button } from "../button";
import { openSubjectMix } from "../../lib/mix-href";
import { themedIcon } from "../../theme/icons";

// "9월 5일 섞어풀기" 기록 화면 본문(웹 mix-session-view.tsx, 설계서 §4.5 #25). 기본은 그 세션에서
// 틀린 문항만(오답노트답게), 칩으로 전체 문항까지 볼 수 있다. 문항 카드는 과목 오답노트와 같은
// 것을 쓰므로 해설·메모·다시 볼 문제 체크·삭제가 그대로 붙는다.
//
// 정답·해설은 EF review-history { view:"mix-note" } 응답에 이미 실려 온다(프리미엄이면 본문,
// 아니면 explanationLocked) — 이 화면은 따로 묻지 않는다. 그 응답은 메모리 전용 쿼리다(§6.5).
const ShuffleIcon = themedIcon(Shuffle);

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
  // 삭제·되돌리기 상태는 화면이 들고 있다 — 토스트가 Screen 의 overlay 슬롯으로 가야 해서다
  // (src/components/screen.tsx ScreenOverlay 머리말).
  deletions,
}: {
  subjectSlug: string;
  questions: ReviewHistoryMixNoteQuestion[];
  wrongCount: number;
  resolvedCount: number;
  lockNext: string;
  deletions: WrongNoteDeletions<string>;
}) {
  const [filter, setFilter] = useState<Filter>(wrongCount > 0 ? "wrong" : "all");

  // 다시 볼 문제 체크는 서버 왕복 없이 즉시 반영. 키는 `${paperId}#${qnum}`.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.pinned).map((q) => `${q.paperId}#${q.questionNumber}`)),
  );
  const { deletedKeys, markDeleted, unmarkDeleted } = deletions;

  const visible = useMemo(() => {
    const list = questions.filter((q) => !deletedKeys.has(`${q.paperId}#${q.questionNumber}`));
    return filter === "wrong" ? list.filter((q) => !q.isCorrect) : list;
  }, [questions, deletedKeys, filter]);

  return (
    <View className="gap-4">
      {/* 웹은 여기에 "틀린 {n}문항 다시 풀기"(createRetryFromMix({sessionId}))가 하나 더 있다.
          앱은 **Phase 3** 로 남긴다(§12 Phase 3 "믹스 기록·재도전", §6.7 #14 EF `mix-create`
          {action:"retry"}). 결과 화면(review/review-result.tsx)도 같은 이유로 mix 에서는 이
          버튼을 그리지 않는다 — 두 화면의 판단을 맞춰 둔다.

          EF review-create 의 items 분기로 대신할 수 없다: 그 분기는 서버가
          filterQuestionsAnsweredByUser 로 "내가 푼 적 있는 (문제지, 문항)"만 남기고, 판정은
          user_question_status 의 paper_id 로 한다. 그런데 섞어풀기 세션 문항
          (review_session_items.paper_id)은 **dedup 대표 문제지 id** 이고(rules/mix-practice.ts
          "출제 가능한 (대표 문제지, 문항)"), 채점은 resolveStatusTargets(rules/status-targets.ts)
          가 "그 사용자가 실제로 상태 행을 가진 문제지"로 되짚어 기록한다. 직류만 다른 중복
          시험지를 CBT 로 응시한 적이 있으면 상태 행은 원본 id 쪽에 남고 대표 id 에는 생기지
          않으므로, 같은 문항을 items 로 돌려보내도 필터에 걸려 빠진다(전부 빠지면 EF 가 400
          "다시 풀 문항이 없어요."). 웹이 mix 에서만 세션 id 통로를 쓰는 이유가 정확히 이것이다
          (웹 review-solver.tsx retryWrong 주석). 서버가 소유자 확인 뒤 세션에서 직접 읽는
          경로가 생기기 전까지는 버튼을 두지 않는다 — 웹과 문항 구성이 다른 재도전은
          "다시 풀기"의 뜻을 바꾼다. */}
      <Button
        variant="tinted"
        label="새로 섞어풀기"
        icon={<ShuffleIcon size={16} colorClassName="text-blue-700 dark:text-blue-400" />}
        accessibilityRole="link"
        onPress={() => openSubjectMix(subjectSlug)}
        className="w-full py-3"
        textClassName="text-sm font-bold"
      />

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
                              onDeleted={() => markDeleted(key, q.paperId, questionNumber)}
                              onDeleteFailed={() => unmarkDeleted(key)}
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

      {/* 되돌리기 토스트는 화면이 Screen 의 overlay 슬롯에 그린다(deletions.toast()). */}
    </View>
  );
}
