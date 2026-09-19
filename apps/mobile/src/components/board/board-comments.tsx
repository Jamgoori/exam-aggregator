import { BOARD_COMMENT_MAX, canDeleteBoardComment, canEditBoardComment, type BoardViewer } from "@gongmoa/core";
import { CornerDownRight, MessageSquare } from "lucide-react-native";
import { useState } from "react";
import { Pressable, TextInput, View } from "react-native";
import { BoardCommentRow, type CommentAction } from "./board-comment-row";
import { AppText } from "../app-text";
import { PendingSpinner } from "../button";
import { LoginPrompt } from "../login-prompt";
import { handleEdgeError } from "../../lib/edge";
import { useBoardCommentWrite, type BoardCommentNode, type BoardCommentWriteRequest } from "../../queries/board";
import { themedIcon } from "../../theme/icons";

// 자유게시판 댓글(웹 board-comments.tsx 1:1). 답글은 1단계까지만 들어간다(더 깊어지면 좁은 화면에서
// 들여쓰기가 감당이 안 된다 — 서버도 같은 규칙 core resolveBoardCommentParent 로 부모를 접어 올린다).
//
// 트리는 화면(app/board/[id]/index.tsx)이 buildBoardCommentTree 로 만들어 넘긴다 — 차단 필터가 거기서
// 적용된다. 아바타도 화면이 목록 전체를 한 번에 받아(useAvatarUrls) 내려준다.
//
// 쓰기는 전부 EF board-write(comment.create/update/delete). 지금 답글을 쓰고 있는 댓글 / 수정 중인 댓글은
// 웹처럼 한 번에 하나만 열린다.
const MessageIcon = themedIcon(MessageSquare);
const ReplyIcon = themedIcon(CornerDownRight);

export function BoardComments({
  postId,
  nodes,
  commentCount,
  viewer,
  avatars,
  targetCommentId,
  highlightedCommentId,
  onTargetLayout,
}: {
  postId: string;
  nodes: BoardCommentNode[];
  // 웹은 board_posts.comment_count 를 그대로 보여준다(차단으로 가려진 댓글도 센다 — 트리거가 세는 값).
  commentCount: number;
  viewer: BoardViewer;
  avatars: Record<string, string>;
  targetCommentId: string | null;
  highlightedCommentId: string | null;
  onTargetLayout: (view: View) => void;
}) {
  const loggedIn = viewer.userId !== null;
  const write = useBoardCommentWrite(postId);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 어느 댓글의 어떤 동작이 진행 중인지(개별 스피너·오류 자리용).
  const [busy, setBusy] = useState<{ id: string; kind: CommentAction } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const newPending = busy === null && write.isPending;

  // 오류는 handleEdgeError 로 푼다(§6.9): 401 → 로그인 모달로 보내고 문구는 그리지 않는다, 429(시간당 30) →
  // "잠시 후 다시 시도해 주세요", 그 외(비속어·길이·권한)는 서버 문구 그대로.
  async function run(req: BoardCommentWriteRequest, marker: { id: string; kind: CommentAction } | null, onDone: () => void) {
    setError(null);
    setRowError(null);
    setBusy(marker);
    try {
      await write.mutateAsync(req);
      onDone();
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/board/${postId}` });
      if (!handled.redirected) {
        if (marker) setRowError({ id: marker.id, message: handled.message });
        else setError(handled.message);
      }
    } finally {
      setBusy(null);
    }
  }

  function submitNew() {
    void run({ action: "comment.create", postId, content }, null, () => setContent(""));
  }

  function renderRow(comment: BoardCommentNode["replies"][number], onReply: (() => void) | null) {
    const ownership = { user_id: comment.authorId };
    return (
      <BoardCommentRow
        comment={comment}
        avatarUrl={avatars[comment.authorId] ?? null}
        loggedIn={loggedIn}
        canEdit={!comment.isDeleted && canEditBoardComment(ownership, viewer)}
        canDelete={!comment.isDeleted && canDeleteBoardComment(ownership, viewer)}
        editing={editingId === comment.id}
        onEdit={() => setEditingId(comment.id)}
        onEditDone={() => {
          setEditingId(null);
          setRowError(null);
        }}
        replying={replyTo === comment.id}
        onReply={onReply}
        onReplyDone={() => {
          setReplyTo(null);
          setRowError(null);
        }}
        onUpdate={(next) =>
          void run({ action: "comment.update", commentId: comment.id, content: next }, { id: comment.id, kind: "update" }, () =>
            setEditingId(null),
          )
        }
        onDelete={() => void run({ action: "comment.delete", commentId: comment.id }, { id: comment.id, kind: "delete" }, () => {})}
        onReplySubmit={(text) =>
          void run(
            { action: "comment.create", postId, content: text, parentId: comment.id },
            { id: comment.id, kind: "reply" },
            () => setReplyTo(null),
          )
        }
        pending={busy?.id === comment.id ? busy.kind : null}
        error={rowError?.id === comment.id ? rowError.message : null}
        targeted={targetCommentId === comment.id}
        highlighted={highlightedCommentId === comment.id}
        onTargetLayout={onTargetLayout}
      />
    );
  }

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-1.5">
        <MessageIcon size={16} colorClassName="text-blue-600 dark:text-blue-400" />
        <AppText variant="base" weight="bold" accessibilityRole="header">
          댓글 {commentCount}
        </AppText>
      </View>

      {loggedIn ? (
        <View className="gap-2">
          <TextInput
            value={content}
            onChangeText={setContent}
            maxLength={BOARD_COMMENT_MAX}
            placeholder="댓글을 남겨보세요"
            placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxFontSizeMultiplier={1.3}
            className="min-h-[88px] w-full rounded-xl border border-zinc-300 px-3.5 py-3 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
          />
          {error && (
            <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
              {error}
            </AppText>
          )}
          <View className="flex-row items-center justify-between">
            <AppText variant="11" className="text-zinc-400 dark:text-zinc-500" tabular>
              {content.length} / {BOARD_COMMENT_MAX}
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: newPending || !content.trim(), busy: newPending }}
              disabled={newPending || !content.trim()}
              onPress={submitNew}
              className={[
                "flex-row items-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2 active:bg-blue-700",
                newPending || !content.trim() ? "opacity-50" : "",
              ].join(" ")}
            >
              {newPending && <PendingSpinner size={13} />}
              <AppText variant="sm" weight="bold" className="text-white">
                {newPending ? "등록 중…" : "댓글 등록"}
              </AppText>
            </Pressable>
          </View>
        </View>
      ) : (
        // 웹은 "로그인하면 댓글을 남길 수 있어요." 한 줄 + 링크. 앱은 게스트 모드 §7.0 의 LoginPrompt(같은
        // 문구 + "로그인하기" → /login?next=이 글)로 그린다.
        <LoginPrompt message="로그인하면 댓글을 남길 수 있어요." />
      )}

      {/* 웹 divide-y — 두 번째 항목부터 border-t. */}
      <View>
        {nodes.length === 0 && (
          <AppText variant="sm" className="py-10 text-center text-zinc-400 dark:text-zinc-500">
            아직 댓글이 없어요. 첫 댓글을 남겨보세요.
          </AppText>
        )}

        {nodes.map((comment, i) => (
          <View key={comment.id} className={["py-3.5", i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : ""].join(" ")}>
            {renderRow(comment, () => setReplyTo(replyTo === comment.id ? null : comment.id))}

            {comment.replies.length > 0 && (
              <View className="mt-2 gap-2 border-l-2 border-zinc-100 pl-3 dark:border-zinc-800">
                {comment.replies.map((reply) => (
                  <View key={reply.id} className="flex-row gap-1.5">
                    <View className="mt-2 shrink-0">
                      <ReplyIcon size={14} colorClassName="text-zinc-300 dark:text-zinc-600" />
                    </View>
                    {/* 답글에는 다시 답글을 달 수 없다(1단계 규칙) — 대신 원 댓글의 "답글" 버튼이 같은 자리를 맡는다. */}
                    <View className="min-w-0 flex-1">{renderRow(reply, null)}</View>
                  </View>
                ))}
              </View>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}
