import { KST_TIME_ZONE, type Comment } from "@gongmoa/core";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";

// 댓글 한 줄(웹 comment-row.tsx): 닉네임/날짜/본문 + 답글·수정·삭제. 삭제는 같은 자리에서 한 번 더
// 확인받는다. 비회원(비밀번호) 댓글의 수정·삭제는 앱 비목표라 비밀번호 입력을 그리지 않는다.
export function CommentRow({
  comment,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  deletePending,
  deleteError,
  canReply,
  isReplying,
  onToggleReply,
}: {
  comment: Comment;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deletePending: boolean;
  deleteError: string | null;
  canReply: boolean;
  isReplying: boolean;
  onToggleReply: () => void;
}) {
  const [confirming, setConfirming] = useState(false);

  const action = "text-zinc-400 dark:text-zinc-600";

  return (
    <View className="gap-1">
      <View className="flex-row items-center justify-between">
        <View className="min-w-0 flex-1 flex-row items-baseline gap-2">
          <AppText variant="sm" weight="bold">
            {comment.nickname}
          </AppText>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-600">
            {new Date(comment.created_at).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE })}
            {comment.updated_at ? " (수정됨)" : ""}
          </AppText>
        </View>
        {(canReply || canEdit || canDelete) && (
          <View className="flex-row gap-2">
            {canReply && (
              <Pressable accessibilityRole="button" accessibilityState={{ expanded: isReplying }} onPress={onToggleReply} hitSlop={6}>
                <AppText variant="11" className={isReplying ? "text-blue-600 dark:text-blue-400" : action}>
                  답글
                </AppText>
              </Pressable>
            )}
            {canEdit && (
              <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={6}>
                <AppText variant="11" className={action}>
                  수정
                </AppText>
              </Pressable>
            )}
            {canDelete && (
              <Pressable accessibilityRole="button" onPress={() => setConfirming((v) => !v)} hitSlop={6}>
                <AppText variant="11" className={action}>
                  삭제
                </AppText>
              </Pressable>
            )}
          </View>
        )}
      </View>
      <AppText variant="sm" className="text-zinc-700 dark:text-zinc-300" pretty>
        {comment.content}
      </AppText>

      {confirming && (
        <View className="mt-2 flex-row flex-wrap items-center gap-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
          <Button
            variant="danger"
            label="삭제 확인"
            pending={deletePending}
            onPress={onDelete}
            className="rounded px-3 py-1"
            textClassName="text-sm font-medium"
          />
          <Pressable accessibilityRole="button" onPress={() => setConfirming(false)} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
              취소
            </AppText>
          </Pressable>
          {deleteError && (
            <AppText variant="sm" className="w-full text-red-600 dark:text-red-400">
              {deleteError}
            </AppText>
          )}
        </View>
      )}
    </View>
  );
}
