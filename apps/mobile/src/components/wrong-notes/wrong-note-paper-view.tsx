import {
  groupRowsBySharedImages,
  KST_TIME_ZONE,
  wrongAnswerKey,
  type PaperRoundComparison,
} from "@gongmoa/core";
import { Check } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { WrongNoteLegend, WrongNoteQuestionCard } from "./wrong-note-question-card";
import { WrongNoteMarkActions, WrongNoteUndoToast } from "./wrong-note-mark-actions";
import { AppText } from "../app-text";
import { RoundAverageCompare } from "../papers/round-average-compare";
import { useOwnWrongAnswers } from "../../queries/attempts";
import { useWrongNoteExplanations } from "../../queries/explanations";
import type { PaperWrongNoteQuestion, PaperWrongNoteRound } from "../../queries/wrong-notes";

// 문제지 오답노트의 본문(웹 wrong-note-paper-view.tsx, 설계서 §4.5 #25). "통합"(모든 회독 합산)이
// 기본이고, 회독 칩을 누르면 그 회독에서 틀린 문제만 그때 고른 답과 함께 보여준다.
//
// 회독 스트립 바로 아래에 회독별 "나 vs 다른 회원 평균"(RoundAverageCompare)을 둔다 — 웹과 같은
// 자리다("내 점수"를 방금 본 자리에서 남들과 견주게 한다). 무료 회원에게는 잠금 링크가 들어간다
// (설계서 §8.3 "회독별 타인 평균" 행).
type ViewKey = "all" | string;

function pct(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE });
}

export function WrongNotePaperView({
  paperId,
  questions,
  rounds,
  unresolvedCount,
  // 무료 회원의 해설·회독 비교 잠금 카드가 결제 후 돌아올 곳.
  lockNext,
  // 회독별 "다른 회원 평균 점수"(멤버십 전용). 무료 회원에게는 빈 배열이 오고, 그 자리에는
  // 무엇이 잠겼는지 알리는 한 줄이 대신 들어간다.
  roundComparisons,
  premium,
}: {
  paperId: string;
  questions: PaperWrongNoteQuestion[];
  rounds: PaperWrongNoteRound[];
  unresolvedCount: number;
  lockNext: string;
  roundComparisons: PaperRoundComparison[];
  premium: boolean;
}) {
  const [view, setView] = useState<ViewKey>("all");
  // "극복한 문제 숨기기" 필터는 통합 보기에서만 의미가 있다.
  const [hideResolved, setHideResolved] = useState(false);

  const [pinnedNumbers, setPinnedNumbers] = useState<Set<number>>(
    () => new Set(questions.filter((q) => q.pinned).map((q) => q.questionNumber)),
  );
  const [deletedNumbers, setDeletedNumbers] = useState<Set<number>>(new Set());
  const [lastDeleted, setLastDeleted] = useState<number | null>(null);
  // UndoToast 의 8초 타이머는 onDismiss 참조가 바뀌면 다시 걸린다 — 안정 참조로 둔다.
  const dismissUndo = useCallback(() => setLastDeleted(null), []);

  const visibleQuestions = useMemo(
    () => questions.filter((q) => !deletedNumbers.has(q.questionNumber)),
    [questions, deletedNumbers],
  );
  const visibleUnresolved = useMemo(() => {
    const removed = questions.filter((q) => !q.resolved && deletedNumbers.has(q.questionNumber)).length;
    return Math.max(0, unresolvedCount - removed);
  }, [questions, deletedNumbers, unresolvedCount]);

  // 정답·해설은 디스크에 남기지 않는 메모리 전용 쿼리로 따로 받아 합친다(설계서 §6.5).
  const answerItems = useMemo(
    () => visibleQuestions.map((q) => ({ paperId, questionNumber: q.questionNumber })),
    [paperId, visibleQuestions],
  );
  const answers = useOwnWrongAnswers(answerItems);
  const wantedNumbers = useMemo(() => visibleQuestions.map((q) => q.questionNumber), [visibleQuestions]);
  const { data: explanations } = useWrongNoteExplanations(paperId, wantedNumbers);

  const byNumber = useMemo(
    () => new Map(visibleQuestions.map((q) => [q.questionNumber, q])),
    [visibleQuestions],
  );

  const selectedRound = view === "all" ? null : (rounds.find((r) => r.attemptId === view) ?? null);

  // 카드에 그릴 줄 목록: 통합이면 누적 오답 전체(가장 최근에 고른 답 기준), 회독이면 그 회독의
  // 오답만(그 회독에서 고른 답 기준).
  const items = useMemo(() => {
    const toItem = (q: PaperWrongNoteQuestion, selectedChoice: number | null) => ({
      images: q.images,
      questionNumber: q.questionNumber,
      selectedChoice,
      correctChoice: answers.data?.[wrongAnswerKey(paperId, q.questionNumber)] ?? null,
      choiceCount: q.choiceCount,
      explanation: explanations.byNumber.get(q.questionNumber) ?? null,
      explanationLocked: explanations.locked.has(q.questionNumber),
      wrongCount: q.wrongCount,
      resolved: q.resolved,
    });
    if (!selectedRound) {
      return visibleQuestions
        .filter((q) => !hideResolved || !q.resolved)
        .map((q) => toItem(q, q.lastSelectedChoice));
    }
    return selectedRound.wrong
      .map((w) => {
        const q = byNumber.get(w.questionNumber);
        return q ? toItem(q, w.selectedChoice) : null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => a.questionNumber - b.questionNumber);
  }, [visibleQuestions, selectedRound, hideResolved, byNumber, answers.data, explanations, paperId]);

  const groups = useMemo(() => groupRowsBySharedImages(items), [items]);

  return (
    <View className="gap-4">
      {/* 회독 스트립: 통합 + 회독별 점수. 가로 스크롤 대신 항상 줄바꿈해서 회독이 많아져도
          화면 폭이 밀리지 않는다(상세는 선택 시 아래 컨텍스트 줄에서). */}
      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="tab"
          accessibilityState={{ selected: view === "all" }}
          onPress={() => setView("all")}
          className={[
            "shrink-0 rounded-full px-4 py-1.5",
            view === "all" ? "bg-blue-600" : "border border-zinc-200 dark:border-zinc-700",
          ].join(" ")}
        >
          <AppText
            variant="sm"
            weight="medium"
            className={view === "all" ? "text-white" : "text-zinc-600 dark:text-zinc-400"}
          >
            전체 회독 · 남은 오답 {visibleUnresolved}
          </AppText>
        </Pressable>
        {rounds.map((r) => {
          const active = view === r.attemptId;
          return (
            <Pressable
              key={r.attemptId}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={`${r.round}회독 ${pct(r.score, r.totalQuestions)}점`}
              onPress={() => setView(r.attemptId)}
              className={[
                "shrink-0 flex-row rounded-full px-4 py-1.5",
                active ? "bg-blue-600" : "border border-zinc-200 dark:border-zinc-700",
              ].join(" ")}
            >
              <AppText variant="sm" weight="semibold" className={active ? "text-white" : "text-zinc-600 dark:text-zinc-400"}>
                {r.round}회독
              </AppText>
              <AppText variant="sm" className={active ? "text-blue-100" : "text-zinc-400 dark:text-zinc-600"}>
                {" "}
                {pct(r.score, r.totalQuestions)}점
              </AppText>
            </Pressable>
          );
        })}
      </View>

      <RoundAverageCompare
        comparisons={roundComparisons}
        premium={premium}
        next={lockNext}
        selectedRound={selectedRound?.round ?? null}
      />

      {/* 지금 보고 있는 것이 무엇인지 한 줄로 설명해주는 컨텍스트. */}
      {selectedRound ? (
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
          {formatDate(selectedRound.createdAt)} 응시 · {selectedRound.totalQuestions}문항 중 {selectedRound.score}문항 정답 ·
          이 회독에서 틀린 문제를 그때 고른 답과 함께 보여드려요.
        </AppText>
      ) : (
        <View className="flex-row flex-wrap items-center justify-between gap-2">
          <AppText variant="xs" className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-500" pretty>
            모든 회독을 합친 보기예요. 답 표시는 가장 최근에 틀렸을 때 기준이에요.
          </AppText>
          {visibleQuestions.some((q) => q.resolved) && (
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: hideResolved }}
              accessibilityLabel="극복한 문제 숨기기"
              onPress={() => setHideResolved((v) => !v)}
              hitSlop={6}
              className="shrink-0 flex-row items-center gap-1.5"
            >
              <View
                className={[
                  "h-3.5 w-3.5 items-center justify-center rounded-sm border",
                  hideResolved ? "border-blue-600 bg-blue-600" : "border-zinc-400 bg-white dark:bg-zinc-900",
                ].join(" ")}
              >
                {hideResolved && <Check size={10} color="#ffffff" />}
              </View>
              <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-400">
                극복한 문제 숨기기
              </AppText>
            </Pressable>
          )}
        </View>
      )}

      {items.length === 0 ? (
        <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
          {selectedRound
            ? "이 회독에서는 틀린 문제가 없어요. 완벽했어요! 🎉"
            : "아직 틀리는 문제가 없어요. 모든 오답을 극복했어요! 🎉"}
        </AppText>
      ) : (
        <>
          <WrongNoteLegend />
          <View className="gap-4">
            {groups.map((group) => (
              <WrongNoteQuestionCard
                key={`${view}-${group.rows[0].questionNumber}`}
                rows={group.rows}
                images={group.images}
                explanationLockNext={lockNext}
                paperId={paperId}
                reportContext="explanation"
                renderRowActions={(questionNumber) => (
                  <WrongNoteMarkActions
                    paperId={paperId}
                    questionNumber={questionNumber}
                    pinned={pinnedNumbers.has(questionNumber)}
                    onPinnedChange={(p) =>
                      setPinnedNumbers((prev) => {
                        const next = new Set(prev);
                        if (p) next.add(questionNumber);
                        else next.delete(questionNumber);
                        return next;
                      })
                    }
                    onDeleted={() => {
                      setDeletedNumbers((prev) => new Set(prev).add(questionNumber));
                      setLastDeleted(questionNumber);
                    }}
                    onDeleteFailed={() => {
                      setDeletedNumbers((prev) => {
                        const next = new Set(prev);
                        next.delete(questionNumber);
                        return next;
                      });
                      setLastDeleted((cur) => (cur === questionNumber ? null : cur));
                    }}
                  />
                )}
              />
            ))}
          </View>
        </>
      )}

      {lastDeleted != null && (
        <WrongNoteUndoToast
          key={lastDeleted}
          paperId={paperId}
          questionNumber={lastDeleted}
          onRestored={() => {
            setDeletedNumbers((prev) => {
              const next = new Set(prev);
              next.delete(lastDeleted);
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
