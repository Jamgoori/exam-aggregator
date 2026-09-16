import { Pencil } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Input } from "../input";
import { useSaveQuestionMemo } from "../../queries/wrong-notes";
import { themedIcon } from "../../theme/icons";

// 문항별 개인 메모(웹 memo-editor.tsx, 설계서 §4.5 #24 — "명시 저장"). 접힌 "메모" 줄을 누르면
// 입력창이 열리고, 저장하면 question_memos 에 upsert(빈 값이면 삭제)한다. 웹의 blur 자동저장은
// 쓰지 않는다 — 키보드가 올라온 채로 화면을 스크롤하는 것만으로 저장이 도는 것을 막는다.
//
// 낙관적 업데이트: 저장을 누른 순간 화면의 메모를 먼저 바꾸고, 실패하면 이전 값으로 되돌리고
// 서버 문구를 그대로 보여준다(설계서 §4.5 #19).
const PencilIcon = themedIcon(Pencil);
const MEMO_MAX = 2000;

export function MemoEditor({
  paperId,
  questionNumber,
  initialMemo,
  // 세트문제처럼 카드에 문항이 여러 개면 번호로 구분.
  label,
}: {
  paperId: string;
  questionNumber: number;
  initialMemo: string | null;
  label?: string;
}) {
  const [memo, setMemo] = useState(initialMemo ?? "");
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(memo);
  const [error, setError] = useState<string | null>(null);
  const save = useSaveQuestionMemo();

  function submit() {
    if (save.isPending) return;
    setError(null);
    const previous = memo;
    const next = draft.trim().slice(0, MEMO_MAX);
    setMemo(next);
    setOpen(false);
    save.mutate(
      { paperId, questionNumber, memo: draft },
      {
        onError: (e) => {
          setMemo(previous);
          setOpen(true);
          setError(e instanceof Error ? e.message : "메모 저장에 실패했어요.");
        },
      },
    );
  }

  if (!open) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={memo ? `${questionNumber}번 메모 편집` : `${questionNumber}번 메모 추가`}
        onPress={() => {
          setDraft(memo);
          setOpen(true);
        }}
        className="w-full flex-row items-start gap-1.5 rounded-lg px-2 py-1.5 active:bg-zinc-50 dark:active:bg-zinc-800/50"
      >
        <View className="mt-0.5 shrink-0">
          <PencilIcon size={12} colorClassName="text-zinc-500 dark:text-zinc-400" />
        </View>
        {memo ? (
          <AppText variant="xs" className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
            {label && (
              <AppText variant="xs" weight="semibold">
                {label}{" "}
              </AppText>
            )}
            {memo}
          </AppText>
        ) : (
          <AppText variant="xs" className="min-w-0 flex-1 text-zinc-500 dark:text-zinc-400">
            {label ? `${label} 메모 추가` : "메모 추가"}
          </AppText>
        )}
      </Pressable>
    );
  }

  return (
    <View className="gap-1.5 px-2 py-1.5">
      <Input
        value={draft}
        onChangeText={setDraft}
        multiline
        numberOfLines={2}
        maxLength={MEMO_MAX}
        autoFocus
        textAlignVertical="top"
        accessibilityLabel={label ? `${label} 메모` : "이 문항에 대한 메모"}
        placeholder={label ? `${label} 메모` : "이 문항에 대한 메모"}
        className="min-h-[52px] text-xs"
      />
      {error && (
        <AppText variant="xs" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
      <View className="flex-row items-center gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: save.isPending, busy: save.isPending }}
          disabled={save.isPending}
          onPress={submit}
          className={["rounded-md bg-blue-600 px-2.5 py-1 active:bg-blue-700", save.isPending ? "opacity-60" : ""].join(" ")}
        >
          <AppText variant="xs" weight="semibold" className="text-white">
            {save.isPending ? "저장 중..." : "저장"}
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setError(null);
            setOpen(false);
          }}
          className="rounded-md px-2 py-1 active:bg-zinc-100 dark:active:bg-zinc-800"
        >
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
            취소
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
