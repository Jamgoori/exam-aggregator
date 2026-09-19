import { router } from "expo-router";
import { Ellipsis, Flag, Heart, Link2, Trash2, UserX } from "lucide-react-native";
import { useState } from "react";
import { Alert, Platform, Pressable, Share, View } from "react-native";
import { BoardReportSheet } from "./board-report-sheet";
import { AppText } from "../app-text";
import { PendingSpinner } from "../button";
import { Sheet } from "../sheet";
import { handleEdgeError } from "../../lib/edge";
import { boardShareUrl, useBlockUser, useDeleteBoardPost, useMyBoardLike, useToggleBoardLike } from "../../queries/board";
import { themedIcon } from "../../theme/icons";

// 글 머리·하단의 동작 버튼들(웹 board-post-actions.tsx 1:1) + 웹에 없는 더보기(신고·차단).
const HeartIcon = themedIcon(Heart);
const LinkIcon = themedIcon(Link2);
const TrashIcon = themedIcon(Trash2);
const MoreIcon = themedIcon(Ellipsis);
const FlagIcon = themedIcon(Flag);
const BlockIcon = themedIcon(UserX);

// 웹 `rounded-lg border border-zinc-200 px-3 py-1.5 text-xs font-medium text-zinc-600` — 공유·수정·삭제·더보기가
// 같은 모양이다(hover 색만 버튼마다 달라 pressed 로 옮겼다).
export const HEADER_BUTTON_CLASS =
  "flex-row items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-1.5 dark:border-zinc-700";
export const HEADER_BUTTON_TEXT = "text-zinc-600 dark:text-zinc-300";

// 하트 채움 색. 아이콘 fill 은 prop 이라 클래스로 못 주고, Tailwind v4 rose-600/rose-400 을 hex 로 푼 값이다
// (테마 토큰에 rose 가 없어 여기 둔다 — 웹 `fill="currentColor"` 자리).
const HEART_FILL = { light: "#ec003f", dark: "#ff637e" } as const;

// 좋아요(웹 BoardLikeButton). 누른 즉시 숫자가 바뀌고(낙관적 — queries/board.ts useToggleBoardLike) 서버가
// 거절하면 되돌린다. 비로그인은 웹처럼 버튼을 숨기지 않고 "로그인 후 이용할 수 있어요." 한 줄을 그 자리에.
export function BoardLikeButton({
  postId,
  likeCount,
  loggedIn,
  dark,
}: {
  postId: string;
  // 글 상세 캐시의 like_count — 토글 뮤테이션이 이 값을 낙관적으로 고치고 서버 값으로 덮는다.
  likeCount: number;
  loggedIn: boolean;
  dark: boolean;
}) {
  const likeQuery = useMyBoardLike(postId);
  const toggle = useToggleBoardLike(postId);
  const [error, setError] = useState<string | null>(null);
  const liked = likeQuery.data ?? false;

  function onPress() {
    if (!loggedIn) {
      setError("로그인 후 이용할 수 있어요.");
      return;
    }
    setError(null);
    toggle.mutate(undefined, { onError: (e) => setError(e.message) });
  }

  return (
    <View className="items-center gap-1.5">
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ selected: liked }}
        accessibilityLabel={`좋아요 ${likeCount}`}
        onPress={onPress}
        className={[
          "flex-row items-center gap-1.5 rounded-full border px-5 py-2.5",
          liked
            ? "border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/30"
            : "border-zinc-200 active:border-rose-200 dark:border-zinc-700 dark:active:border-rose-900",
        ].join(" ")}
      >
        <HeartIcon
          size={16}
          colorClassName={liked ? "text-rose-600 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400"}
          fill={liked ? (dark ? HEART_FILL.dark : HEART_FILL.light) : "none"}
        />
        <AppText
          variant="sm"
          weight="bold"
          tabular
          className={liked ? "text-rose-600 dark:text-rose-400" : "text-zinc-500 dark:text-zinc-400"}
        >
          좋아요 {likeCount}
        </AppText>
      </Pressable>
      {error && (
        <AppText variant="xs" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
    </View>
  );
}

// 공유(웹 BoardShareButton 은 현재 주소를 클립보드에 복사하고 "주소 복사됨"으로 2초 바뀐다). 앱은 OS 공유
// 시트를 연다 — 폰에서는 그것이 "공유"의 뜻이고 복사도 그 시트 안에 있다. 주소는 항상 웹 정본 URL
// (queries/board.ts boardShareUrl, §6.7 #32). Android 는 url 필드를 무시하므로 message 에 싣는다.
export function BoardShareButton({ postId }: { postId: string }) {
  const url = boardShareUrl(postId);
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => {
        void Share.share(Platform.OS === "ios" ? { url } : { message: url }).catch(() => {
          // 사용자가 시트를 닫았거나 공유 대상이 없는 기기 — 웹도 클립보드 실패를 조용히 넘긴다.
        });
      }}
      className={[HEADER_BUTTON_CLASS, "active:border-blue-300 dark:active:border-blue-800"].join(" ")}
    >
      <LinkIcon size={13} colorClassName={HEADER_BUTTON_TEXT} />
      <AppText variant="xs" weight="medium" className={HEADER_BUTTON_TEXT}>
        공유
      </AppText>
    </Pressable>
  );
}

// 삭제(웹 BoardDeleteButton — window.confirm → deleteBoardPost → /board). 확인은 OS Alert 로(웹 confirm 문구
// 그대로). 성공하면 목록으로 **replace** 한다 — 뒤로가기로 지워진 글에 되돌아오지 않게.
export function BoardDeleteButton({ postId }: { postId: string }) {
  const remove = useDeleteBoardPost();
  const [error, setError] = useState<string | null>(null);

  function confirm() {
    Alert.alert("이 글을 삭제할까요? 되돌릴 수 없어요.", undefined, [
      { text: "취소", style: "cancel" },
      {
        text: "삭제",
        style: "destructive",
        onPress: () => {
          setError(null);
          remove.mutate(postId, {
            onSuccess: () => router.replace("/board"),
            onError: async (e) => {
              const handled = await handleEdgeError(e, { next: `/board/${postId}` });
              if (!handled.redirected) setError(handled.message);
            },
          });
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
        {remove.isPending ? (
          <PendingSpinner size={13} colorClassName={HEADER_BUTTON_TEXT} />
        ) : (
          <TrashIcon size={13} colorClassName={HEADER_BUTTON_TEXT} />
        )}
        <AppText variant="xs" weight="medium" className={HEADER_BUTTON_TEXT}>
          {remove.isPending ? "삭제 중…" : "삭제"}
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

// 더보기(⋯) — **웹에 없다**(스토어 UGC 요건: 신고·차단 수단, 설계서 §6.7 #18). 본인 글에는 그리지 않는다
// (호출부가 판단). 신고는 시트(board-report-sheet.tsx), 차단은 OS Alert 로 한 번 확인한 뒤 RPC block_user —
// 성공하면 blocks 캐시가 바뀌어 이 글·이 사용자의 댓글이 상세·목록에서 곧바로 빠진다(상세 화면이 차단
// 안내로 바뀌는 것이 곧 확인 문구다). 비로그인은 신고·차단 모두 로그인이 필요하므로 웹 좋아요와 같은
// 문구를 그 자리에 보여준다.
export function BoardMoreMenu({ postId, authorId, loggedIn }: { postId: string; authorId: string; loggedIn: boolean }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const block = useBlockUser();

  function confirmBlock() {
    setMenuOpen(false);
    Alert.alert(
      "이 사용자를 차단할까요?",
      "차단한 사용자의 글과 댓글이 보이지 않아요. 내 정보 수정에서 해제할 수 있어요.",
      [
        { text: "취소", style: "cancel" },
        {
          text: "차단",
          style: "destructive",
          onPress: () => {
            setError(null);
            block.mutate(authorId, { onError: (e) => setError(e.message) });
          },
        },
      ],
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="더보기"
        onPress={() => {
          if (!loggedIn) {
            setError("로그인 후 이용할 수 있어요.");
            return;
          }
          setError(null);
          setMenuOpen(true);
        }}
        className={[HEADER_BUTTON_CLASS, "active:border-blue-300 dark:active:border-blue-800"].join(" ")}
      >
        <MoreIcon size={13} colorClassName={HEADER_BUTTON_TEXT} />
      </Pressable>
      {error && (
        <AppText variant="xs" accessibilityRole="alert" className="w-full text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}

      <Sheet visible={menuOpen} onClose={() => setMenuOpen(false)} showHandle>
        <View className="px-3 pt-1 pb-3">
          <MenuRow
            icon={<FlagIcon size={18} colorClassName="text-zinc-600 dark:text-zinc-300" />}
            label="신고"
            onPress={() => {
              setMenuOpen(false);
              setReportOpen(true);
            }}
          />
          <MenuRow
            icon={<BlockIcon size={18} colorClassName="text-red-600 dark:text-red-400" />}
            label="이 사용자 차단"
            labelClassName="text-red-600 dark:text-red-400"
            onPress={confirmBlock}
          />
        </View>
      </Sheet>

      <BoardReportSheet postId={postId} visible={reportOpen} onClose={() => setReportOpen(false)} />
    </>
  );
}

function MenuRow({
  icon,
  label,
  labelClassName,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  labelClassName?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="menuitem"
      onPress={onPress}
      className="flex-row items-center gap-3 rounded-xl px-3 py-3.5 active:bg-zinc-100 dark:active:bg-zinc-800"
    >
      {icon}
      <AppText variant="base" weight="medium" className={labelClassName ?? "text-zinc-800 dark:text-zinc-100"}>
        {label}
      </AppText>
    </Pressable>
  );
}
