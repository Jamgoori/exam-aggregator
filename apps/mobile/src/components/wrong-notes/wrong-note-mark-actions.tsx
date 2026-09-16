import { BookmarkCheck, Trash2 } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { UndoToast } from "../feedback";
import {
  useDeleteWrongNoteQuestion,
  useRestoreWrongNoteQuestion,
  useSetQuestionPinned,
} from "../../queries/wrong-notes";
import { themedIcon } from "../../theme/icons";

// 오답노트 문항 카드의 우측 액션(웹 wrong-note-mark-actions.tsx, 설계서 §4.5 #25):
// "다시 볼 문제" 체크 토글 + 완전 삭제. 상태(핀·삭제 목록)는 부모(목록 컴포넌트)가 들고 있어
// 토글·삭제가 필터에 즉시 반영되고, 서버 반영이 실패하면 되돌린다(낙관적 업데이트).
const BookmarkIcon = themedIcon(BookmarkCheck);
const TrashIcon = themedIcon(Trash2);

const DELETE_CONFIRM_TITLE = "이 문항을 오답노트에서 완전히 삭제할까요?";
const DELETE_CONFIRM_BODY =
  "오답 목록·통계·다시 풀기에서 더 이상 보이지 않아요. (삭제 직후 '되돌리기'로 복구할 수 있어요)";

export function WrongNoteMarkActions({
  paperId,
  questionNumber,
  pinned,
  onPinnedChange,
  onDeleted,
  onDeleteFailed,
}: {
  paperId: string;
  questionNumber: number;
  pinned: boolean;
  onPinnedChange: (pinned: boolean) => void;
  // 목록에서 감추고 되돌리기 토스트를 띄운다(낙관적 — 서버 반영 전에 부른다).
  onDeleted: () => void;
  // 서버 반영이 실패했을 때 되돌린다.
  onDeleteFailed: () => void;
}) {
  const setPinned = useSetQuestionPinned();
  const remove = useDeleteWrongNoteQuestion();

  function togglePin() {
    const next = !pinned;
    onPinnedChange(next);
    setPinned.mutate(
      { paperId, questionNumber, pinned: next },
      {
        onError: (e) => {
          onPinnedChange(!next);
          Alert.alert(e instanceof Error ? e.message : "저장에 실패했어요.");
        },
      },
    );
  }

  function confirmRemove() {
    Alert.alert(DELETE_CONFIRM_TITLE, DELETE_CONFIRM_BODY, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          // 낙관적: 목록에서 먼저 빼고(되돌리기 토스트가 뜬다) 실패하면 되살린다.
          onDeleted();
          remove.mutate(
            { paperId, questionNumber },
            {
              onError: (e) => {
                onDeleteFailed();
                Alert.alert(e instanceof Error ? e.message : "삭제에 실패했어요.");
              },
            },
          );
        },
      },
    ]);
  }

  return (
    <View className="shrink-0 flex-row items-center gap-1">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: pinned }}
        accessibilityLabel={pinned ? `${questionNumber}번 다시 볼 문제에서 해제` : `${questionNumber}번 다시 볼 문제로 체크`}
        onPress={togglePin}
        hitSlop={6}
        className={[
          "flex-row items-center gap-1 rounded-full border px-2 py-0.5",
          pinned
            ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
            : "border-zinc-200 dark:border-zinc-700",
        ].join(" ")}
      >
        <BookmarkIcon
          size={13}
          colorClassName={pinned ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"}
        />
        <AppText
          variant="xs"
          weight="medium"
          allowFontScaling={false}
          className={pinned ? "text-amber-600 dark:text-amber-400" : "text-zinc-400 dark:text-zinc-500"}
        >
          다시보기
        </AppText>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${questionNumber}번 오답노트에서 삭제`}
        accessibilityState={{ disabled: remove.isPending, busy: remove.isPending }}
        disabled={remove.isPending}
        onPress={confirmRemove}
        hitSlop={6}
        className="h-6 w-6 items-center justify-center rounded-full active:bg-red-50 dark:active:bg-red-950/30"
      >
        <TrashIcon size={13} colorClassName="text-zinc-300 dark:text-zinc-600" />
      </Pressable>
    </View>
  );
}

// 삭제 직후 잠깐 뜨는 "되돌리기" 토스트(웹 WrongNoteUndoToast). 오클릭으로 오답 기록을 잃지
// 않게 하는 안전장치로, 8초 뒤(또는 다른 문항을 삭제하면 교체되어) 사라진다 — 부모가 key 로
// 문항마다 새로 마운트해 타이머가 삭제 건별로 다시 시작된다(UndoToast 가 유일한 토스트, §4.5 #11).
export function WrongNoteUndoToast({
  paperId,
  questionNumber,
  onRestored,
  onDismiss,
  bottomClassName,
}: {
  paperId: string;
  questionNumber: number;
  onRestored: () => void;
  onDismiss: () => void;
  bottomClassName?: string;
}) {
  const restore = useRestoreWrongNoteQuestion();
  return (
    <UndoToast
      visible
      message={`${questionNumber}번 문항을 오답노트에서 삭제했어요`}
      pending={restore.isPending}
      bottomClassName={bottomClassName}
      onUndo={() => {
        if (restore.isPending) return;
        restore.mutate(
          { paperId, questionNumber },
          {
            onSuccess: onRestored,
            onError: (e) => Alert.alert(e instanceof Error ? e.message : "되돌리지 못했어요."),
          },
        );
      }}
      onDismiss={onDismiss}
    />
  );
}

// 삭제 + 되돌리기 상태를 **화면**이 들고 있게 하는 훅.
//
// 토스트는 뷰포트에 고정돼야 해서 `Screen` 의 overlay 슬롯으로 들어가야 하는데(screen.tsx
// ScreenOverlay 머리말), 삭제 목록(`deletedKeys`)은 본문 목록이 필터에 쓴다. 둘이 같은
// 상태라 목록 컴포넌트 안에 두면 토스트를 위로 올릴 수 없다 — 그래서 상태만 화면으로 올리고
// 목록 컴포넌트는 값을 받아 쓴다. 과목 오답노트(문항 모아보기)·문제지 오답노트·섞어풀기 기록
// 세 화면이 같은 훅을 쓴다(키 타입만 다르다: `${paperId}#${n}` 또는 문항 번호).
export type WrongNoteDeletions<K extends string | number> = {
  deletedKeys: ReadonlySet<K>;
  // 낙관적 삭제(서버 반영 전에 부른다) — 목록에서 감추고 되돌리기 토스트를 띄운다.
  markDeleted: (key: K, paperId: string, questionNumber: number) => void;
  // 서버 반영이 실패했을 때 되돌린다.
  unmarkDeleted: (key: K) => void;
  // `Screen overlay` 에 그대로 넘긴다. 삭제한 문항이 없으면 null.
  toast: (opts?: { bottomClassName?: string }) => React.ReactNode;
};

export function useWrongNoteDeletions<K extends string | number>(): WrongNoteDeletions<K> {
  const [deletedKeys, setDeletedKeys] = useState<Set<K>>(() => new Set<K>());
  const [lastDeleted, setLastDeleted] = useState<{ key: K; paperId: string; questionNumber: number } | null>(null);
  // UndoToast 의 8초 타이머는 onDismiss 참조가 바뀌면 다시 걸린다 — 안정 참조로 둔다.
  const dismiss = useCallback(() => setLastDeleted(null), []);

  const markDeleted = useCallback((key: K, paperId: string, questionNumber: number) => {
    setDeletedKeys((prev) => new Set(prev).add(key));
    setLastDeleted({ key, paperId, questionNumber });
  }, []);

  const unmarkDeleted = useCallback((key: K) => {
    setDeletedKeys((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    setLastDeleted((cur) => (cur?.key === key ? null : cur));
  }, []);

  const toast = useCallback(
    (opts?: { bottomClassName?: string }) =>
      lastDeleted ? (
        <WrongNoteUndoToast
          key={lastDeleted.key}
          paperId={lastDeleted.paperId}
          questionNumber={lastDeleted.questionNumber}
          bottomClassName={opts?.bottomClassName}
          onRestored={() => {
            setDeletedKeys((prev) => {
              const next = new Set(prev);
              next.delete(lastDeleted.key);
              return next;
            });
            setLastDeleted(null);
          }}
          onDismiss={dismiss}
        />
      ) : null,
    [lastDeleted, dismiss],
  );

  return useMemo(
    () => ({ deletedKeys, markDeleted, unmarkDeleted, toast }),
    [deletedKeys, markDeleted, unmarkDeleted, toast],
  );
}
