import { buildCommentTree, canReplyTo, COMMENT_CONTENT_MAX, type Comment, type CommentNode } from "@gongmoa/core";
import { useState } from "react";
import { TextInput, View } from "react-native";
import { CommentRow } from "./comment-row";
import { EditRow } from "./comment-edit-row";
import { ReplyForm } from "./comment-reply-form";
import { AppText } from "../app-text";
import { Button } from "../button";
import { LoginPrompt } from "../login-prompt";
import { handleEdgeError } from "../../lib/edge";
import { useCommentsWrite } from "../../queries/comments";

// 댓글 영역 전체(웹 comments-section.tsx): 새 댓글 폼 + 댓글/답글 트리(core buildCommentTree).
// 쓰기는 전부 Edge comments-write(create/update/delete, 설계서 §4.5 #21). 비회원(비밀번호)
// 댓글 작성·수정·삭제는 앱 비목표라 그 폼은 그리지 않는다 — user_id 가 null 인 댓글은 읽기만.
export function CommentsSection({
  paperId,
  comments,
  currentUserId,
}: {
  paperId: string;
  comments: Comment[];
  currentUserId: string | null;
}) {
  const loggedIn = !!currentUserId;
  const write = useCommentsWrite(paperId);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [replyingToId, setReplyingToId] = useState<string | null>(null);
  // 어느 댓글의 어떤 동작이 진행 중인지(개별 스피너·오류 자리용).
  const [busy, setBusy] = useState<{ id: string; kind: "delete" | "update" | "reply" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);

  const tree = buildCommentTree(comments);

  async function run(
    req: Parameters<typeof write.mutateAsync>[0],
    marker: { id: string; kind: "delete" | "update" | "reply" } | null,
    onDone: () => void,
  ) {
    setError(null);
    setRowError(null);
    setBusy(marker);
    try {
      await write.mutateAsync(req);
      onDone();
    } catch (e) {
      const handled = await handleEdgeError(e);
      if (!handled.redirected) {
        if (marker) setRowError({ id: marker.id, message: handled.message });
        else setError(handled.message);
      }
    } finally {
      setBusy(null);
    }
  }

  function submitNew() {
    if (!content.trim()) return;
    void run({ action: "create", paperId, content }, null, () => setContent(""));
  }

  function renderRow(comment: Comment, opts: { canReply: boolean; isReplying: boolean }) {
    const mine = comment.user_id !== null && comment.user_id === currentUserId;
    if (editingId === comment.id) {
      return (
        <EditRow
          comment={comment}
          pending={busy?.id === comment.id && busy.kind === "update"}
          error={rowError?.id === comment.id ? rowError.message : null}
          onSave={(next) =>
            void run({ action: "update", commentId: comment.id, content: next }, { id: comment.id, kind: "update" }, () =>
              setEditingId(null),
            )
          }
          onCancel={() => {
            setEditingId(null);
            setRowError(null);
          }}
        />
      );
    }
    return (
      <CommentRow
        comment={comment}
        canEdit={mine}
        canDelete={mine}
        onEdit={() => setEditingId(comment.id)}
        onDelete={() => void run({ action: "delete", commentId: comment.id }, { id: comment.id, kind: "delete" }, () => {})}
        deletePending={busy?.id === comment.id && busy.kind === "delete"}
        deleteError={rowError?.id === comment.id ? rowError.message : null}
        canReply={opts.canReply}
        isReplying={opts.isReplying}
        onToggleReply={() => setReplyingToId((v) => (v === comment.id ? null : comment.id))}
      />
    );
  }

  // 한 댓글과 그 아래 답글들을 재귀로 그린다. 답글 폼은 깊이 한도에 닿지 않은 댓글에만.
  function renderNode(node: CommentNode): React.ReactNode {
    const replyable = loggedIn && canReplyTo(node.depth);
    return (
      <>
        {renderRow(node, { canReply: replyable, isReplying: replyingToId === node.id })}

        {node.replies.length > 0 && (
          <View className="mt-4 ml-6 gap-4 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
            {node.replies.map((reply) => (
              <View key={reply.id}>{renderNode(reply)}</View>
            ))}
          </View>
        )}

        {replyingToId === node.id && (
          <View className="mt-4 ml-6 border-l-2 border-zinc-100 pl-4 dark:border-zinc-700">
            <ReplyForm
              pending={busy?.id === node.id && busy.kind === "reply"}
              error={rowError?.id === node.id ? rowError.message : null}
              onSubmit={(text) =>
                void run({ action: "create", paperId, parentId: node.id, content: text }, { id: node.id, kind: "reply" }, () =>
                  setReplyingToId(null),
                )
              }
              onCancel={() => {
                setReplyingToId(null);
                setRowError(null);
              }}
            />
          </View>
        )}
      </>
    );
  }

  return (
    <View className="gap-5">
      <AppText variant="lg" weight="semibold">
        댓글 {comments.length}개
      </AppText>

      {/* 댓글은 로그인한 사람만 — 게스트 모드 §7.0 문구(comments-section.tsx:139-145). */}
      {!loggedIn ? (
        <LoginPrompt message="댓글은 로그인 후 남길 수 있어요" />
      ) : (
        <View className="gap-3">
          <TextInput
            value={content}
            onChangeText={setContent}
            maxLength={COMMENT_CONTENT_MAX}
            placeholder="이 시험에 대한 의견을 남겨주세요"
            placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxFontSizeMultiplier={1.3}
            className="min-h-[80px] w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:text-zinc-100"
          />
          {error && (
            <AppText variant="sm" className="text-red-600 dark:text-red-400">
              {error}
            </AppText>
          )}
          <Button
            label={busy === null && write.isPending ? "등록 중..." : "댓글 등록"}
            pending={busy === null && write.isPending}
            disabled={!content.trim()}
            onPress={submitNew}
            className="self-end rounded-lg px-5 py-2"
            textClassName="text-sm font-medium"
          />
        </View>
      )}

      <View className="divide-y divide-zinc-100 dark:divide-zinc-700">
        {tree.length === 0 && (
          <AppText variant="sm" className="py-10 text-center text-zinc-500 dark:text-zinc-500">
            아직 댓글이 없어요. 첫 댓글을 남겨보세요.
          </AppText>
        )}
        {tree.map((node) => (
          <View key={node.id} className="py-5">
            {renderNode(node)}
          </View>
        ))}
      </View>
    </View>
  );
}
