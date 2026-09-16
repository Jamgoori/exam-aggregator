import {
  levelColor,
  wrongAnswerKey,
  type QuestionExplanationContent,
  type ReviewPickStrategy,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Check, Shuffle } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { WrongNoteFilterChip } from "./filter-chip";
import { WrongNoteLegend, WrongNoteQuestionCard, type WrongNoteCardRow } from "./wrong-note-question-card";
import { WrongNoteMarkActions, type WrongNoteDeletions } from "./wrong-note-mark-actions";
import { MemoEditor } from "./memo-editor";
import { AppText } from "../app-text";
import { Button } from "../button";
import { CenterModal } from "../sheet";
import { useOwnWrongAnswers } from "../../queries/attempts";
import { useWrongNoteExplanationsByPaper } from "../../queries/explanations";
import { useCreateReviewSession, type SubjectWrongNoteQuestion } from "../../queries/wrong-notes";

// 과목 오답노트 "문제만 모아보기" 탭 본문(웹 subject-wrong-note-questions.tsx, 설계서 §4.5 #25).
// 문제지 경계 없이 그 과목에서 틀린 문항을 한 목록으로 펼치고, 미극복·반복 오답·다시 볼 문제
// 필터와 정렬을 서버 왕복 없이 즉시 적용한다.
//
// 정답(RPC own_wrong_answers)과 해설(EF explanations-get context:"wrong-note")은 목록 골격과
// 달리 디스크에 남기지 않는 메모리 전용 쿼리라 여기서 따로 받아 합친다(설계서 §6.5).
type SortKey = "number" | "recent" | "frequent";

const SORT_LABELS: { key: SortKey; label: string }[] = [
  { key: "number", label: "문제지·번호순" },
  { key: "recent", label: "최근 틀린 순" },
  { key: "frequent", label: "자주 틀린 순" },
];

type Card = {
  paperId: string;
  paperTitle: string;
  paperLevel: string | null;
  images: string[];
  rows: WrongNoteCardRow[];
  // 메모 등 문항 원본이 필요한 UI용(카드 아래 메모 입력).
  source: SubjectWrongNoteQuestion[];
};

const qKey = (q: { paperId: string; questionNumber: number }) => `${q.paperId}#${q.questionNumber}`;

// 문항 선택 → "선택한 N개 다시 풀기" 상태. 하단 바가 뷰포트에 고정돼야 해서(screen.tsx
// ScreenOverlay 머리말) 상태는 화면이 들고 바는 `Screen` 의 overlay 슬롯에서 그린다 —
// 체크박스는 본문 목록에 있으므로 같은 객체를 목록에도 내려 준다.
export type SubjectWrongNoteSelection = {
  selected: ReadonlySet<string>;
  toggle: (paperId: string, questionNumber: number) => void;
  clear: () => void;
  start: () => void;
  pending: boolean;
  error: string | null;
};

export function useSubjectWrongNoteSelection(subjectSlug: string): SubjectWrongNoteSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [error, setError] = useState<string | null>(null);
  const launch = useCreateReviewSession();

  const toggle = useCallback((paperId: string, questionNumber: number) => {
    const key = `${paperId}#${questionNumber}`;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const start = useCallback(() => {
    if (launch.isPending || selected.size === 0) return;
    setError(null);
    const items = [...selected].map((k) => {
      const idx = k.lastIndexOf("#");
      return { paperId: k.slice(0, idx), questionNumber: Number(k.slice(idx + 1)) };
    });
    launch.mutate(
      { items },
      {
        onSuccess: (sessionId) => router.push(`/mypage/wrong-notes/${subjectSlug}/review/${sessionId}` as Href),
        onError: (e) => setError(e instanceof Error ? e.message : "다시 풀기를 시작하지 못했어요."),
      },
    );
    // launch.mutate 는 안정 참조.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch.isPending, selected, subjectSlug]);

  return useMemo(
    () => ({ selected, toggle, clear, start, pending: launch.isPending, error }),
    [selected, toggle, clear, start, launch.isPending, error],
  );
}

// 문항을 고르면 뜨는 하단 바(웹과 같은 `bottom-4 z-30` + `max-w-md rounded-2xl border p-2
// shadow-lg`), 그 위 `bottom-20` 에 오류 한 줄. safe-area·탭바 여백은 Screen 의 overlay 슬롯이
// 잡아 주므로 여기서는 웹 클래스를 그대로 쓴다.
export function SubjectWrongNoteSelectionBar({ selection }: { selection: SubjectWrongNoteSelection }) {
  const { selected, clear, start, pending, error } = selection;
  return (
    <>
      {selected.size > 0 && (
        <View pointerEvents="box-none" className="absolute inset-x-0 bottom-4 z-30 items-center px-4">
          <View className="w-full max-w-md flex-row items-center gap-2 rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <Pressable
              accessibilityRole="button"
              onPress={clear}
              className="shrink-0 rounded-lg px-3 py-2 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <AppText variant="sm" weight="medium" className="text-zinc-500 dark:text-zinc-400">
                해제
              </AppText>
            </Pressable>
            <Button
              label={pending ? "준비 중..." : `선택한 ${selected.size}개 다시 풀기`}
              icon={<Shuffle size={15} color="#ffffff" />}
              pending={pending}
              onPress={start}
              className="flex-1 rounded-lg py-2.5"
            />
          </View>
        </View>
      )}
      {error && (
        <View pointerEvents="none" className="absolute inset-x-0 bottom-20 z-30 items-center px-4">
          <AppText variant="xs" className="text-center text-red-600 dark:text-red-400">
            {error}
          </AppText>
        </View>
      )}
    </>
  );
}

export function SubjectWrongNoteQuestions({
  questions,
  unresolvedCount,
  subjectSlug,
  selection,
  deletions,
}: {
  questions: SubjectWrongNoteQuestion[];
  unresolvedCount: number;
  subjectSlug: string;
  selection: SubjectWrongNoteSelection;
  deletions: WrongNoteDeletions<string>;
}) {
  const [hideResolved, setHideResolved] = useState(false);
  const [onlyRepeated, setOnlyRepeated] = useState(false);
  const [onlyPinned, setOnlyPinned] = useState(false);
  const [sort, setSort] = useState<SortKey>("number");
  const [sortOpen, setSortOpen] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  // 섞어풀기가 후보를 뽑는 방식. 기본은 층 정원제(2번 이상 틀림 > 최근 오답 > 나머지).
  const [strategy, setStrategy] = useState<ReviewPickStrategy>("weighted");

  // 다시보기 체크는 서버 왕복 없이 즉시 반영한다. 키는 `${paperId}#${qnum}`.
  const [pinnedKeys, setPinnedKeys] = useState<Set<string>>(
    () => new Set(questions.filter((q) => q.pinned).map(qKey)),
  );
  // 완전 삭제·되돌리기는 화면이 들고 있다(토스트가 overlay 슬롯으로 가야 해서).
  const { deletedKeys, markDeleted, unmarkDeleted } = deletions;
  const { selected, toggle: toggleSelect } = selection;

  const shuffle = useCreateReviewSession();

  // 삭제된 문항을 뺀 "지금 화면의 전체 목록". 카운트·필터·섞어풀기 후보가 전부 이 목록 기준이라
  // 삭제가 숫자에도 바로 반영된다.
  const visible = useMemo(() => questions.filter((q) => !deletedKeys.has(qKey(q))), [questions, deletedKeys]);
  const visibleUnresolved = useMemo(() => {
    const removedUnresolved = questions.filter((q) => !q.resolved && deletedKeys.has(qKey(q))).length;
    return Math.max(0, unresolvedCount - removedUnresolved);
  }, [questions, deletedKeys, unresolvedCount]);

  // 정답은 본인이 답한 문항만 온다(RPC own_wrong_answers) — 메모리 전용.
  const answerItems = useMemo(
    () => visible.map((q) => ({ paperId: q.paperId, questionNumber: q.questionNumber })),
    [visible],
  );
  const answers = useOwnWrongAnswers(answerItems);

  // 필터를 통과한 목록 — 카드가 이 목록 기준이다(해설 요청은 아래 explanationRequests 참고).
  const filtered = useMemo(() => {
    let list = visible;
    if (hideResolved) list = list.filter((q) => !q.resolved);
    if (onlyRepeated) list = list.filter((q) => q.wrongCount >= 2);
    if (onlyPinned) list = list.filter((q) => pinnedKeys.has(qKey(q)));
    return list;
  }, [visible, hideResolved, onlyRepeated, onlyPinned, pinnedKeys]);

  // 해설 요청은 EF 한 번 = 문제지 하나라, **필터 전** 전체 목록으로 만든다. 필터·정렬·삭제는
  // 화면에 무엇을 그릴지만 정하고 요청은 건드리지 않는다 — 걸러진 목록으로 만들면 체크 하나에
  // 문제지마다 새 요청이 나갔다(쿼리 키도 이제 문제지 단위라 같은 문제지면 같은 키다).
  // `questions` 는 이미 (문제지 제목, 번호) 순이라 기본 정렬의 화면 순서와 같고, 훅이 그
  // 순서대로 조금씩 열어 위쪽 카드부터 채운다(queries/explanations.ts EXPLANATION_PAPER_BATCH).
  const explanationRequests = useMemo(() => {
    const byPaper = new Map<string, number[]>();
    for (const q of questions) {
      const list = byPaper.get(q.paperId);
      if (list) list.push(q.questionNumber);
      else byPaper.set(q.paperId, [q.questionNumber]);
    }
    return [...byPaper.entries()].map(([paperId, questionNumbers]) => ({ paperId, questionNumbers }));
  }, [questions]);
  const explanations = useWrongNoteExplanationsByPaper(explanationRequests);

  function toRow(q: SubjectWrongNoteQuestion): WrongNoteCardRow {
    const paper = explanations.get(q.paperId);
    const explanation: QuestionExplanationContent | null = paper?.byNumber.get(q.questionNumber) ?? null;
    return {
      questionNumber: q.questionNumber,
      selectedChoice: q.selectedChoice,
      correctChoice: answers.data?.[wrongAnswerKey(q.paperId, q.questionNumber)] ?? null,
      choiceCount: q.choiceCount,
      explanation,
      explanationLocked: paper?.locked.has(q.questionNumber) ?? false,
      wrongCount: q.wrongCount,
      resolved: q.resolved,
      wrongRatePct: q.wrongRatePct,
    };
  }

  function goToSession(sessionId: string) {
    router.push(`/mypage/wrong-notes/${subjectSlug}/review/${sessionId}` as Href);
  }

  // 이미지가 있어 실제로 풀 수 있는 미극복 오답만 섞어풀기 대상이 된다(서버도 같은 기준).
  const playableUnresolved = useMemo(
    () => visible.filter((q) => !q.resolved && q.images.length > 0).length,
    [visible],
  );

  function startShuffle() {
    if (shuffle.isPending) return;
    setReviewError(null);
    shuffle.mutate(
      { subjectSlug, onlyUnresolved: true, strategy },
      {
        onSuccess: goToSession,
        onError: (e) => setReviewError(e instanceof Error ? e.message : "다시 풀기를 시작하지 못했어요."),
      },
    );
  }

  const cards = useMemo(() => {
    const list = filtered;

    // 먼저 세트문제(같은 문제지 + 동일 이미지 배열)를 한 그룹으로 묶은 뒤 그룹 단위로 정렬한다.
    // 문항 단위로 정렬하면 "최근/자주 틀린 순"에서 세트 구성원이 흩어져 같은 지문 이미지가
    // 여러 카드로 중복 렌더된다.
    const groupMap = new Map<string, SubjectWrongNoteQuestion[]>();
    const order: string[] = [];
    for (const q of list) {
      const sig = q.images.length > 0 ? `${q.paperId}|${q.images.join("")}` : `${q.paperId}|solo|${q.questionNumber}`;
      const arr = groupMap.get(sig);
      if (arr) arr.push(q);
      else {
        groupMap.set(sig, [q]);
        order.push(sig);
      }
    }

    const groups = order.map((sig) => {
      const qs = groupMap.get(sig)!.sort((a, b) => a.questionNumber - b.questionNumber);
      const head = qs[0];
      return {
        group: qs,
        head,
        recentAt: qs.reduce((m, q) => (q.lastWrongAt > m ? q.lastWrongAt : m), qs[0].lastWrongAt),
        maxWrong: qs.reduce((m, q) => Math.max(m, q.wrongCount), 0),
        title: head.paperTitle,
        minNumber: head.questionNumber,
      };
    });

    groups.sort((a, b) => {
      if (sort === "recent") {
        const t = b.recentAt.localeCompare(a.recentAt);
        if (t !== 0) return t;
      } else if (sort === "frequent") {
        if (a.maxWrong !== b.maxWrong) return b.maxWrong - a.maxWrong;
        const t = b.recentAt.localeCompare(a.recentAt);
        if (t !== 0) return t;
      }
      return a.title.localeCompare(b.title, "ko") || a.minNumber - b.minNumber;
    });

    return groups.map(
      (g): Card => ({
        paperId: g.head.paperId,
        paperTitle: g.head.paperTitle,
        paperLevel: g.head.paperLevel,
        images: g.head.images,
        rows: g.group.map(toRow),
        source: g.group,
      }),
    );
    // toRow 는 정답·해설 캐시를 읽는다 — 그 값이 도착하면 카드도 다시 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sort, answers.data, explanations]);

  const hasResolved = visible.some((q) => q.resolved);
  const hasRepeated = visible.some((q) => q.wrongCount >= 2);
  const hasPinned = pinnedKeys.size > 0;

  function markPinned(key: string, pinned: boolean) {
    setPinnedKeys((prev) => {
      const next = new Set(prev);
      if (pinned) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  // 해설 잠금 카드가 결제 후 돌아올 곳(무료 회원 화면에서만 쓰인다).
  const lockNext = `/mypage/wrong-notes/${subjectSlug}?view=questions`;

  return (
    <View className={["gap-4", selected.size > 0 ? "pb-24" : ""].join(" ")}>
      {playableUnresolved > 0 ? (
        <View className="gap-1.5">
          <Button
            label={shuffle.isPending ? "준비 중..." : `남은 오답 ${playableUnresolved}개 섞어서 다시 풀기`}
            icon={<Shuffle size={16} color="#ffffff" />}
            pending={shuffle.isPending}
            onPress={startShuffle}
            className="w-full py-3"
          />
          {/* 뽑는 방식은 설정 화면이 아니라 버튼 바로 아래 — 이 버튼이 무엇을 하는지의 일부다. */}
          <View className="flex-row items-center justify-center gap-1.5">
            <PickChip label="약한 문제 우선" active={strategy === "weighted"} onPress={() => setStrategy("weighted")} />
            <PickChip label="전체 랜덤" active={strategy === "random"} onPress={() => setStrategy("random")} />
          </View>
          <AppText variant="11" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
            {strategy === "weighted"
              ? "2번 이상 틀린 문제를 많이, 오래된 오답도 조금 섞어서 내요."
              : "남은 오답 전체에서 똑같은 확률로 뽑아요."}
          </AppText>
          {reviewError && (
            <AppText variant="xs" className="text-center text-red-600 dark:text-red-400">
              {reviewError}
            </AppText>
          )}
        </View>
      ) : (
        visibleUnresolved > 0 && (
          <View className="rounded-xl border border-zinc-200 px-3 py-2.5 dark:border-zinc-700">
            <AppText variant="xs" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
              아직 문제 이미지가 등록된 오답이 없어 다시 풀기를 준비 중이에요.
            </AppText>
          </View>
        )
      )}

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="-mx-4"
        contentContainerClassName="flex-row items-center gap-2 px-4"
      >
        <WrongNoteFilterChip label="남은 오답만" active={hideResolved} disabled={!hasResolved} onPress={() => setHideResolved((v) => !v)} />
        <WrongNoteFilterChip label="2번 이상 틀림" active={onlyRepeated} disabled={!hasRepeated} onPress={() => setOnlyRepeated((v) => !v)} />
        <WrongNoteFilterChip
          label="다시 볼 문제만"
          active={onlyPinned}
          disabled={!hasPinned && !onlyPinned}
          onPress={() => setOnlyPinned((v) => !v)}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`정렬: ${SORT_LABELS.find((s) => s.key === sort)!.label}`}
          onPress={() => setSortOpen(true)}
          className="shrink-0 rounded-full border border-zinc-200 bg-white px-3.5 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        >
          <AppText variant="sm" weight="medium" className="text-zinc-600 dark:text-zinc-400">
            {SORT_LABELS.find((s) => s.key === sort)!.label}
          </AppText>
        </Pressable>
      </ScrollView>

      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
        이 과목에서 틀린 문제를 시험지 구분 없이 모았어요. 답 표시는 가장 최근에 틀렸을 때 기준이에요. 전체 오답{" "}
        {visible.length}개 · 남은 오답 {visibleUnresolved}개.
      </AppText>

      {cards.length === 0 ? (
        <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
          {hideResolved || onlyRepeated || onlyPinned
            ? "이 조건에 맞는 문항이 없어요. 필터를 바꿔보세요."
            : "이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀면 틀린 문제가 자동으로 모여요."}
        </AppText>
      ) : (
        <>
          <WrongNoteLegend />
          <View className="gap-5">
            {cards.map((card, i) => (
              <View key={`${sort}-${card.paperId}-${card.rows[0].questionNumber}-${i}`} className="gap-1.5">
                <View className="flex-row items-center gap-2">
                  {card.paperLevel && (
                    <View className={["shrink-0 rounded px-1.5 py-0.5", levelColor(card.paperLevel)].join(" ")}>
                      <AppText variant="11" weight="bold" allowFontScaling={false} className={levelColor(card.paperLevel)}>
                        {card.paperLevel}
                      </AppText>
                    </View>
                  )}
                  <AppText variant="xs" weight="medium" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400">
                    {card.paperTitle}
                  </AppText>
                </View>
                <WrongNoteQuestionCard
                  rows={card.rows}
                  images={card.images}
                  explanationLockNext={lockNext}
                  paperId={card.paperId}
                  reportContext="explanation"
                  renderRowActions={(questionNumber) => {
                    const key = `${card.paperId}#${questionNumber}`;
                    return (
                      <WrongNoteMarkActions
                        paperId={card.paperId}
                        questionNumber={questionNumber}
                        pinned={pinnedKeys.has(key)}
                        onPinnedChange={(p) => markPinned(key, p)}
                        onDeleted={() => markDeleted(key, card.paperId, questionNumber)}
                        onDeleteFailed={() => unmarkDeleted(key)}
                      />
                    );
                  }}
                />
                {/* 웹 divide-y — Uniwind 는 자식 선택자를 버리므로 두 번째 항목부터 border-t 로
                    그린다(comments-section.tsx 와 같은 처리). */}
                <View className="rounded-xl border border-zinc-100 dark:border-zinc-700/70">
                  {card.source.map((q, rowIndex) => {
                    const key = qKey(q);
                    const checked = selected.has(key);
                    return (
                      <View
                        key={q.questionNumber}
                        className={[
                          "flex-row items-start gap-1",
                          rowIndex > 0 ? "border-t border-zinc-100 dark:border-zinc-700" : "",
                        ].join(" ")}
                      >
                        <Pressable
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked }}
                          accessibilityLabel={`${q.questionNumber}번 선택`}
                          onPress={() => toggleSelect(q.paperId, q.questionNumber)}
                          hitSlop={6}
                          className="shrink-0 flex-row items-center gap-1 py-2 pl-2"
                        >
                          <View
                            className={[
                              "h-4 w-4 items-center justify-center rounded border",
                              checked ? "border-blue-600 bg-blue-600" : "border-zinc-400 bg-white dark:bg-zinc-900",
                            ].join(" ")}
                          >
                            {checked && <Check size={12} color="#ffffff" />}
                          </View>
                          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
                            선택
                          </AppText>
                        </Pressable>
                        <View className="min-w-0 flex-1">
                          <MemoEditor
                            paperId={q.paperId}
                            questionNumber={q.questionNumber}
                            initialMemo={q.memo}
                            label={card.source.length > 1 ? `${q.questionNumber}번` : undefined}
                          />
                        </View>
                      </View>
                    );
                  })}
                </View>
              </View>
            ))}
          </View>
        </>
      )}

      {/* 하단 선택 바(SubjectWrongNoteSelectionBar)·되돌리기 토스트는 화면이 Screen 의 overlay
          슬롯에 그린다 — 여기(ScrollView 콘텐츠) 안에 두면 긴 목록에서 화면 밖으로 밀린다. */}

      {/* 웹 <select> 자리 — 앱은 목록 모달(설계서 §4.5 #27 "연도 select → Sheet 목록"). */}
      <CenterModal visible={sortOpen} onClose={() => setSortOpen(false)} size="md">
        <AppText weight="semibold" className="mb-3">
          정렬
        </AppText>
        <View className="gap-1">
          {SORT_LABELS.map((s) => (
            <Pressable
              key={s.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: sort === s.key, checked: sort === s.key }}
              onPress={() => {
                setSort(s.key);
                setSortOpen(false);
              }}
              className="rounded-lg px-3 py-2.5 active:bg-zinc-100 dark:active:bg-zinc-800"
            >
              <AppText
                variant="sm"
                weight={sort === s.key ? "semibold" : "normal"}
                className={sort === s.key ? "text-blue-600 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-300"}
              >
                {s.label}
              </AppText>
            </Pressable>
          ))}
        </View>
      </CenterModal>
    </View>
  );
}

// 섞어풀기 뽑기 방식 칩. 필터 칩보다 한 단계 작게 둬서 "필터가 하나 더 늘었다"로 읽히지 않게
// 한다 — 목록을 거르는 게 아니라 버튼의 동작을 고르는 자리다.
function PickChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={["rounded-full px-3 py-1", active ? "bg-blue-100 dark:bg-blue-950/60" : ""].join(" ")}
    >
      <AppText
        variant="xs"
        weight="medium"
        className={active ? "text-blue-700 dark:text-blue-300" : "text-zinc-500 dark:text-zinc-500"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}
