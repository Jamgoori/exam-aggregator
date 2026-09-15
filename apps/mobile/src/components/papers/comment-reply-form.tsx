import { COMMENT_CONTENT_MAX } from "@gongmoa/core";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";

// 댓글 아래에 인라인으로 열리는 답글 작성 폼(웹 comment-reply-form.tsx). 로그인한 사람만
// 쓸 수 있어(호출부가 답글 버튼 자체를 감춘다) 닉네임·비밀번호 입력이 없다.
export function ReplyForm({
  onSubmit,
  pending,
  error,
  onCancel,
}: {
  onSubmit: (content: string) => void;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
}) {
  const [content, setContent] = useState("");

  return (
    <View className="gap-2">
      <TextInput
        value={content}
        onChangeText={setContent}
        maxLength={COMMENT_CONTENT_MAX}
        placeholder="답글을 입력해주세요"
        placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
        multiline
        autoFocus
        numberOfLines={2}
        textAlignVertical="top"
        maxFontSizeMultiplier={1.3}
        className="min-h-[60px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
      />
      {error && (
        <AppText variant="sm" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
      <View className="flex-row justify-end gap-2">
        <Pressable accessibilityRole="button" onPress={onCancel} className="rounded-lg px-3 py-1.5">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            취소
          </AppText>
        </Pressable>
        <Button
          label={pending ? "등록 중..." : "답글 등록"}
          pending={pending}
          disabled={!content.trim()}
          onPress={() => onSubmit(content)}
          className="rounded-lg px-4 py-1.5"
          textClassName="text-sm font-medium"
        />
      </View>
    </View>
  );
}
