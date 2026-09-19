import { router } from "expo-router";
import { useState } from "react";
import { Alert, Pressable } from "react-native";
import { AppText } from "../app-text";
import { PendingSpinner } from "../button";
import { HEADER_BUTTON_CLASS, HEADER_BUTTON_TEXT } from "../board/board-post-actions";
import { handleEdgeError } from "../../lib/edge";
import { useDeleteSuggestion } from "../../queries/suggestions";

// 상세 화면의 삭제 버튼(웹 suggestion-delete-button.tsx 1:1). 되돌릴 수 없는 동작이라 한 번 확인을 받는다 —
// 웹 confirm 문구 그대로 OS Alert 로. 성공하면 목록으로 **replace** 한다(웹 router.replace("/suggestions")) —
// 뒤로가기로 지워진 글에 되돌아오지 않게. 버튼 모양은 웹 `rounded-lg border px-3 py-1.5 text-xs` — 게시판
// 머리 버튼과 같은 클래스라 그쪽 상수를 쓴다.
export function SuggestionDeleteButton({ id }: { id: string }) {
  const remove = useDeleteSuggestion();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    Alert.alert("이 글을 삭제할까요? 삭제하면 되돌릴 수 없어요.", undefined, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          setError(null);
          remove.mutate(
            { action: "delete", id },
            {
              onSuccess: () => router.replace("/suggestions"),
              onError: async (e) => {
                const handled = await handleEdgeError(e, { next: `/suggestions/${id}` });
                if (!handled.redirected) setError(handled.message);
              },
            },
          );
        },
      },
    ]);
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: remove.isPending, busy: remove.isPending }}
        disabled={remove.isPending}
        onPress={confirm}
        className={[
          HEADER_BUTTON_CLASS,
          "active:border-red-300 dark:active:border-red-900",
          remove.isPending ? "opacity-50" : "",
        ].join(" ")}
      >
        {remove.isPending && <PendingSpinner size={13} colorClassName={HEADER_BUTTON_TEXT} />}
        <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-400">
          {remove.isPending ? "삭제 중..." : "삭제"}
        </AppText>
      </Pressable>
      {error && (
        <AppText variant="xs" accessibilityRole="alert" className="w-full text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
    </>
  );
}
