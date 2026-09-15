import { COMMENT_CONTENT_MAX, type Comment } from "@gongmoa/core";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";

// 댓글을 그 자리에서 고치는 편집 폼(웹 comment-edit-row.tsx). 비회원 댓글 비밀번호는 앱 비목표.
export function EditRow({
  comment,
  onSave,
  pending,
  error,
  onCancel,
}: {
  comment: Comment;
  onSave: (content: string) => void;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(comment.content);

  return (
    <View className="gap-2">
      <TextInput
        value={content}
        onChangeText={setContent}
        maxLength={COMMENT_CONTENT_MAX}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        maxFontSizeMultiplier={1.3}
        className="min-h-[80px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
      />
      <View className="flex-row flex-wrap items-center gap-2">
        <Button
          label="저장"
          pending={pending}
          disabled={!content.trim()}
          onPress={() => onSave(content)}
          className="rounded px-3 py-1"
          textClassName="text-sm font-medium"
        />
        <Pressable accessibilityRole="button" onPress={onCancel} hitSlop={6}>
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            취소
          </AppText>
        </Pressable>
        {error && (
          <AppText variant="sm" className="w-full text-red-600 dark:text-red-400">
            {error}
          </AppText>
        )}
      </View>
    </View>
  );
}
