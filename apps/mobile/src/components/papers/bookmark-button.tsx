import { router } from "expo-router";
import { Bookmark } from "lucide-react-native";
import { Pressable } from "react-native";
import { loginHref, useCurrentHref } from "../login-link";
import { useMyBookmarkedPaperIds, useTogglePaperBookmark } from "../../queries/bookmarks";
import { useAuth } from "../../providers/auth-provider";
import { useIsDark } from "../../theme";

// 문제지 즐겨찾기 버튼(웹 bookmark-button.tsx). 상태는 ['me',u,'bookmarks'] 캐시가 정본이라
// 화면 어디서 눌러도 같은 값을 본다(웹은 initialBookmarked 로컬 상태). 낙관적 업데이트는
// queries/bookmarks.ts. 비로그인은 웹처럼 /login?next= 로 보낸다.
export function BookmarkButton({
  paperId,
  // 캐시가 아직 없을 때(상세 화면 첫 렌더 등) 쓸 초기값.
  initialBookmarked = false,
  size = "md",
}: {
  paperId: string;
  initialBookmarked?: boolean;
  // 목록 카드처럼 좁은 자리에 넣을 때는 "sm"으로 줄인다.
  size?: "sm" | "md";
}) {
  const { userId } = useAuth();
  const current = useCurrentHref();
  const dark = useIsDark();
  const { query, set } = useMyBookmarkedPaperIds();
  const toggle = useTogglePaperBookmark();
  const bookmarked = query.data ? set.has(paperId) : initialBookmarked;
  const pending = toggle.isPending && toggle.variables?.paperId === paperId;

  function onPress() {
    if (!userId) {
      router.push(loginHref(current));
      return;
    }
    toggle.mutate({ paperId, next: !bookmarked });
  }

  const iconSize = size === "sm" ? 14 : 18;
  // lucide color 는 prop — 웹 text-amber-500 / text-zinc-600(다크 amber-400 / zinc-400).
  const color = bookmarked ? (dark ? "#ffb900" : "#fd9a00") : dark ? "#9f9fa9" : "#52525c";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? "즐겨찾기 해제" : "즐겨찾기 추가"}
      accessibilityState={{ selected: bookmarked, disabled: pending }}
      accessibilityHint={userId ? undefined : "로그인 후 이용할 수 있어요"}
      disabled={pending}
      onPress={onPress}
      hitSlop={6}
      className={[
        "shrink-0 items-center justify-center rounded-full border",
        size === "sm" ? "p-1.5" : "p-2.5",
        bookmarked
          ? "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30"
          : "border-zinc-300 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-700 dark:active:bg-blue-950/40",
        pending ? "opacity-50" : "",
      ].join(" ")}
    >
      <Bookmark size={iconSize} color={color} fill={bookmarked ? color : "none"} />
    </Pressable>
  );
}
