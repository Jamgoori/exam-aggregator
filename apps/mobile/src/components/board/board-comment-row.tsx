import { BOARD_COMMENT_MAX } from "@gongmoa/core";
import { useRef, useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { formatBoardCommentDateTime } from "./board-format";
import { AppText } from "../app-text";
import { Avatar } from "../avatar";
import { PendingSpinner } from "../button";
import type { BoardCommentItem } from "../../queries/board";

// 댓글 한 줄(웹 board-comments.tsx CommentRow 1:1): 아바타·닉네임·날짜·(수정됨) → 본문(또는 편집 폼) →
// 답글·수정·삭제 → 오류 → 답글 폼. 뮤테이션은 부모(board-comments.tsx)가 한 벌 들고 있고 이 줄은
// 요청과 결과 표시만 맡는다.
//
// 알림 링크(`#comment-{id}`)로 들어온 댓글은 `targeted` — 레이아웃이 잡히면 부모에게 자기 View 를 넘겨
// 스크롤시키고(웹 ScrollToHash), `highlighted` 동안 배경을 잠깐 칠한다(웹 :target 에 준하는 표시 —
// 웹 CSS 에는 :target 규칙이 없어 색은 blue-50 으로 골랐다).
export type CommentAction = "update" | "delete" | "reply";

const SMALL_BUTTON = "rounded-lg px-3 py-1.5";

export function BoardCommentRow({
  comment,
  avatarUrl,
  loggedIn,
  canEdit,
  canDelete,
  editing,
  onEdit,
  onEditDone,
  replying,
  onReply,
  onReplyDone,
  onUpdate,
  onDelete,
  onReplySubmit,
  pending,
  error,
  targeted,
  highlighted,
  onTargetLayout,
}: {
  comment: BoardCommentItem;
  avatarUrl: string | null;
  loggedIn: boolean;
  canEdit: boolean;
  canDelete: boolean;
  editing: boolean;
  onEdit: () => void;
  onEditDone: () => void;
  replying: boolean;
  // null 이면 답글 버튼이 없다(답글에는 다시 답글을 달 수 없다 — 1단계 규칙).
  onReply: (() => void) | null;
  onReplyDone: () => void;
  onUpdate: (content: string) => void;
  onDelete: () => void;
  onReplySubmit: (content: string) => void;
  // 이 줄에서 진행 중인 동작(개별 스피너용).
  pending: CommentAction | null;
  error: string | null;
  targeted: boolean;
  highlighted: boolean;
  onTargetLayout: (view: View) => void;
}) {
  const [draft, setDraft] = useState(comment.content);
  const [replyText, setReplyText] = useState("");
  const rootRef = useRef<View>(null);
  // 편집이 열릴 때마다 저장된 본문에서 다시 시작하고, 답글 폼이 닫히면(등록 성공·취소) 입력을 비운다 —
  // 웹은 폼이 언마운트되며 사라지는 값인데 이 줄은 마운트된 채 남아 명시적으로 되돌린다(렌더 중
  // "prop 변화에 상태 맞추기").
  const [seenEditing, setSeenEditing] = useState(editing);
  if (seenEditing !== editing) {
    setSeenEditing(editing);
    if (editing) setDraft(comment.content);
  }
  const [seenReplying, setSeenReplying] = useState(replying);
  if (seenReplying !== replying) {
    setSeenReplying(replying);
    if (!replying) setReplyText("");
  }

  if (comment.isDeleted) {
    return (
      <AppText variant="sm" className="py-1 italic text-zinc-400 dark:text-zinc-500">
        삭제된 댓글입니다.
      </AppText>
    );
  }

  function confirmDelete() {
    Alert.alert("댓글을 삭제할까요?", undefined, [
      { text: "취소", style: "cancel" },
      { text: "삭제", style: "destructive", onPress: onDelete },
    ]);
  }

  return (
    <View
      ref={rootRef}
      onLayout={() => {
        if (targeted && rootRef.current) onTargetLayout(rootRef.current);
      }}
      className={[
        "gap-1.5",
        // 강조는 줄 바깥 여백까지 칠해 글자에 딱 붙지 않게(-mx-2 px-2 py-1).
        highlighted ? "-mx-2 rounded-lg bg-blue-50 px-2 py-1 dark:bg-blue-950/30" : "",
      ].join(" ")}
    >
      <View className="flex-row flex-wrap items-center gap-2">
        <Avatar nickname={comment.nickname} avatarUrl={avatarUrl} size="sm" />
        <AppText variant="13" weight="semibold">
          {comment.nickname}
        </AppText>
        <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
          {formatBoardCommentDateTime(comment.createdAt)}
        </AppText>
        {comment.updatedAt && (
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
            (수정됨)
          </AppText>
        )}
      </View>

      {editing ? (
        <View className="gap-2">
          <TextInput
            value={draft}
            onChangeText={setDraft}
            maxLength={BOARD_COMMENT_MAX}
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxFontSizeMultiplier={1.3}
            className="min-h-[80px] w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <View className="flex-row justify-end gap-2">
            <Pressable
              accessibilityRole="button"
              onPress={onEditDone}
              className={[SMALL_BUTTON, "border border-zinc-200 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"].join(" ")}
            >
              <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-400">
                취소
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending === "update", busy: pending === "update" }}
              disabled={pending === "update"}
              onPress={() => onUpdate(draft)}
              className={[SMALL_BUTTON, "flex-row items-center gap-1.5 bg-blue-600 active:bg-blue-700", pending === "update" ? "opacity-50" : ""].join(" ")}
            >
              {pending === "update" && <PendingSpinner size={12} />}
              <AppText variant="xs" weight="bold" className="text-white">
                저장
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : (
        // 웹 `text-sm leading-6 whitespace-pre-wrap text-zinc-700` — RN Text 는 개행을 그대로 그린다.
        <AppText variant="sm" className="leading-6 text-zinc-700 dark:text-zinc-200" pretty>
          {comment.content}
        </AppText>
      )}

      {!editing && (
        <View className="flex-row gap-3">
          {onReply && loggedIn && (
            <Pressable accessibilityRole="button" accessibilityState={{ expanded: replying }} onPress={onReply} hitSlop={6}>
              <AppText variant="11" weight="medium" className="text-zinc-400 dark:text-zinc-500">
                {replying ? "답글 취소" : "답글"}
              </AppText>
            </Pressable>
          )}
          {canEdit && (
            <Pressable accessibilityRole="button" onPress={onEdit} hitSlop={6}>
              <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                수정
              </AppText>
            </Pressable>
          )}
          {canDelete && (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending === "delete", busy: pending === "delete" }}
              disabled={pending === "delete"}
              onPress={confirmDelete}
              hitSlop={6}
            >
              <AppText variant="11" className="text-zinc-400 dark:text-zinc-500">
                {pending === "delete" ? "삭제 중…" : "삭제"}
              </AppText>
            </Pressable>
          )}
        </View>
      )}

      {error && (
        <AppText variant="xs" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}

      {replying && (
        <View className="mt-1 gap-2">
          <TextInput
            value={replyText}
            onChangeText={setReplyText}
            maxLength={BOARD_COMMENT_MAX}
            placeholder={`${comment.nickname}님에게 답글 남기기`}
            placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
            multiline
            autoFocus
            numberOfLines={2}
            textAlignVertical="top"
            maxFontSizeMultiplier={1.3}
            className="min-h-[60px] w-full rounded-xl border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          <View className="flex-row justify-end gap-2">
            <Pressable
              accessibilityRole="button"
              onPress={onReplyDone}
              className={[SMALL_BUTTON, "border border-zinc-200 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"].join(" ")}
            >
              <AppText variant="xs" weight="medium" className="text-zinc-500 dark:text-zinc-400">
                취소
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: pending === "reply" || !replyText.trim(), busy: pending === "reply" }}
              disabled={pending === "reply" || !replyText.trim()}
              onPress={() => onReplySubmit(replyText)}
              className={[
                SMALL_BUTTON,
                "flex-row items-center gap-1.5 bg-blue-600 active:bg-blue-700",
                pending === "reply" || !replyText.trim() ? "opacity-50" : "",
              ].join(" ")}
            >
              {pending === "reply" && <PendingSpinner size={12} />}
              <AppText variant="xs" weight="bold" className="text-white">
                답글 등록
              </AppText>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}
