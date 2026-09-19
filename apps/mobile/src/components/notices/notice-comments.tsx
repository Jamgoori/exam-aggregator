import { canDeleteNoticeComment, canEditNoticeComment, NOTICE_COMMENT_MAX, type NoticeViewer } from "@gongmoa/core";
import { useState } from "react";
import { Alert, Pressable, TextInput, View } from "react-native";
import { formatNoticeDateTime } from "./notice-format";
import { AppText } from "../app-text";
import { PendingSpinner } from "../button";
import { LoginPrompt } from "../login-prompt";
import { handleEdgeError } from "../../lib/edge";
import { useNoticeCommentWrite, type NoticeCommentItem } from "../../queries/notices";

// 공지 상세 화면의 댓글 영역(웹 notice-comments.tsx 1:1). 답글 트리 없이 평평한 목록이다 — 로그인 회원만
// 쓸 수 있고 공지 하나에 딸린 짧은 의견들이라, 문제지 댓글의 답글·비회원 비밀번호 같은 복잡함이 필요
// 없다(웹 머리말). 아바타도 없다 — 웹 공지 댓글 줄에 아바타가 없어서(닉네임·시각만) 그대로 따른다.
//
// 원글(제목·내용)은 관리자만 쓸 수 있지만 댓글은 반대로 로그인 회원이면 누구나 달 수 있다 — loggedIn 만
// 확인하면 되고 별도 admin 분기는 없다. 수정·삭제 권한은 웹이 서버에서 계산해 항목에 실어 주던 값을
// 여기서 같은 core 함수(canEditNoticeComment/canDeleteNoticeComment)로 센다.
//
// 쓰기는 전부 EF notices-write(comment.create/update/delete). 수정 중인 댓글은 웹처럼 한 번에 하나만 열린다.
const TEXTAREA_CLASS =
  "w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm leading-5 text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export function NoticeComments({
  noticeId,
  comments,
  viewer,
}: {
  noticeId: string;
  comments: NoticeCommentItem[];
  viewer: NoticeViewer;
}) {
  const loggedIn = viewer.userId !== null;
  const write = useNoticeCommentWrite(noticeId);
  const [content, setContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // 어느 댓글의 어떤 동작이 진행 중인지(개별 스피너·오류 자리용). null 이면 새 댓글 등록이 진행 중이다.
  const [busy, setBusy] = useState<{ id: string; kind: "update" | "delete" } | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const newPending = busy === null && write.isPending;

  // 오류는 handleEdgeError 로 푼다(§6.9): 401 → 로그인 모달로 보내고 문구는 그리지 않는다, 429(시간당 30) →
  // "잠시 후 다시 시도해 주세요", 그 외(비속어·길이·권한)는 서버 문구 그대로. 웹은 삭제 실패를 아무 말 없이
  // 삼키지만(router.refresh 만 안 한다) 앱은 새로고침이 저절로 일어나지 않아 "눌렀는데 그대로"가 되므로
  // 삭제 실패도 그 줄에 한 문장 남긴다.
  async function run(
    req: Parameters<typeof write.mutateAsync>[0],
    marker: { id: string; kind: "update" | "delete" } | null,
    onDone: () => void,
  ) {
    setError(null);
    setRowError(null);
    setBusy(marker);
    try {
      await write.mutateAsync(req);
      onDone();
    } catch (e) {
      const handled = await handleEdgeError(e, { next: `/notices/${noticeId}` });
      if (!handled.redirected) {
        if (marker) setRowError({ id: marker.id, message: handled.message });
        else setError(handled.message);
      }
    } finally {
      setBusy(null);
    }
  }

  function submitNew() {
    void run({ action: "comment.create", noticeId, content }, null, () => setContent(""));
  }

  // 웹 textarea 의 `required` — 비어 있으면 보내지 않는다(공백만 있는 값은 웹처럼 서버가 "댓글 내용을
  // 입력해주세요."로 돌려보낸다).
  const newDisabled = newPending || content.length === 0;

  return (
    <View className="gap-4">
      <AppText variant="base" weight="semibold" accessibilityRole="header">
        댓글 {comments.length}개
      </AppText>

      {loggedIn ? (
        <View className="gap-2">
          <TextInput
            value={content}
            onChangeText={setContent}
            maxLength={NOTICE_COMMENT_MAX}
            placeholder="댓글을 남겨주세요"
            placeholderTextColorClassName="text-zinc-400 dark:text-zinc-500"
            multiline
            numberOfLines={3}
            textAlignVertical="top"
            maxFontSizeMultiplier={1.3}
            className={["min-h-[80px]", TEXTAREA_CLASS].join(" ")}
          />
          {error && (
            <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
              {error}
            </AppText>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ disabled: newDisabled, busy: newPending }}
            disabled={newDisabled}
            onPress={submitNew}
            className={[
              "flex-row items-center gap-1.5 self-end rounded-lg bg-blue-600 px-4 py-1.5 active:bg-blue-700",
              newDisabled ? "opacity-50" : "",
            ].join(" ")}
          >
            {newPending && <PendingSpinner size={13} />}
            <AppText variant="sm" weight="medium" className="text-white">
              {newPending ? "등록 중..." : "댓글 등록"}
            </AppText>
          </Pressable>
        </View>
      ) : (
        // 웹은 회색 상자에 한 줄. 앱은 게스트 모드 §7.0 의 LoginPrompt(같은 문구 + "로그인하기" →
        // /login?next=이 공지)로 그린다 — 로그인으로 가는 길이 그 자리에 있어야 한다.
        <LoginPrompt message="로그인 후 댓글을 남길 수 있어요." />
      )}

      {/* 웹 divide-y — 두 번째 항목부터 border-t. */}
      <View>
        {comments.length === 0 && (
          <AppText variant="sm" className="py-6 text-center text-zinc-400 dark:text-zinc-500">
            아직 댓글이 없어요.
          </AppText>
        )}

        {comments.map((c, i) => {
          const ownership = { user_id: c.authorId };
          const canEdit = canEditNoticeComment(ownership, viewer);
          const canDelete = canDeleteNoticeComment(ownership, viewer);
          const pending = busy?.id === c.id ? busy.kind : null;
          const message = rowError?.id === c.id ? rowError.message : null;
          const dividerClass = i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : "";

          if (editingId === c.id) {
            return (
              <View key={c.id} className={["py-3", dividerClass].join(" ")}>
                <EditCommentRow
                  comment={c}
                  pending={pending === "update"}
                  error={message}
                  onSubmit={(next) =>
                    void run({ action: "comment.update", commentId: c.id, content: next }, { id: c.id, kind: "update" }, () =>
                      setEditingId(null),
                    )
                  }
                  onCancel={() => {
                    setEditingId(null);
                    setRowError(null);
                  }}
                />
              </View>
            );
          }

          return (
            <View key={c.id} className={["gap-1 py-3", dividerClass].join(" ")}>
              <View className="flex-row flex-wrap items-center gap-2">
                <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-300">
                  {c.nickname}
                </AppText>
                <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                  {formatNoticeDateTime(c.createdAt)}
                </AppText>
                {c.updatedAt && (
                  <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                    (수정됨)
                  </AppText>
                )}
              </View>
              {/* 웹 `text-sm whitespace-pre-wrap text-zinc-700` — RN Text 는 개행을 그대로 그린다. */}
              <AppText variant="sm" className="text-zinc-700 dark:text-zinc-200" pretty>
                {c.content}
              </AppText>
              {(canEdit || canDelete) && (
                <View className="mt-0.5 flex-row gap-3">
                  {canEdit && (
                    <Pressable accessibilityRole="button" onPress={() => setEditingId(c.id)} hitSlop={6}>
                      <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                        수정
                      </AppText>
                    </Pressable>
                  )}
                  {canDelete && (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: pending === "delete", busy: pending === "delete" }}
                      disabled={pending === "delete"}
                      onPress={() =>
                        // 웹 confirm("댓글을 삭제할까요?") 자리.
                        Alert.alert("댓글을 삭제할까요?", undefined, [
                          { text: "취소", style: "cancel" },
                          {
                            text: "삭제",
                            style: "destructive",
                            onPress: () =>
                              void run({ action: "comment.delete", commentId: c.id }, { id: c.id, kind: "delete" }, () => {}),
                          },
                        ])
                      }
                      hitSlop={6}
                    >
                      <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
                        {pending === "delete" ? "삭제 중..." : "삭제"}
                      </AppText>
                    </Pressable>
                  )}
                </View>
              )}
              {message && (
                <AppText variant="xs" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
                  {message}
                </AppText>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

// 수정 폼(웹 EditCommentRow). 열릴 때 저장된 본문으로 시작한다 — 이 컴포넌트는 편집이 열릴 때 마운트되고
// 닫히면 언마운트되므로(웹과 같은 조건부 렌더) useState 초기값으로 충분하다.
function EditCommentRow({
  comment,
  pending,
  error,
  onSubmit,
  onCancel,
}: {
  comment: NoticeCommentItem;
  pending: boolean;
  error: string | null;
  onSubmit: (content: string) => void;
  onCancel: () => void;
}) {
  const [content, setContent] = useState(comment.content);
  return (
    <View className="gap-2">
      <TextInput
        value={content}
        onChangeText={setContent}
        maxLength={NOTICE_COMMENT_MAX}
        multiline
        numberOfLines={3}
        textAlignVertical="top"
        maxFontSizeMultiplier={1.3}
        className={["min-h-[80px]", TEXTAREA_CLASS].join(" ")}
      />
      {error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
      <View className="flex-row justify-end gap-2">
        <Pressable
          accessibilityRole="button"
          onPress={onCancel}
          className="rounded-lg border border-zinc-200 px-3 py-1 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800"
        >
          <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-300">
            취소
          </AppText>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: pending, busy: pending }}
          disabled={pending}
          onPress={() => onSubmit(content)}
          className={["flex-row items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1 active:bg-blue-700", pending ? "opacity-50" : ""].join(" ")}
        >
          {pending && <PendingSpinner size={12} />}
          <AppText variant="xs" weight="medium" className="text-white">
            {pending ? "저장 중..." : "저장"}
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
