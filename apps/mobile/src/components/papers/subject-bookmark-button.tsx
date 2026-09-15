import { router } from "expo-router";
import { Star } from "lucide-react-native";
import { Pressable } from "react-native";
import { loginHref, useCurrentHref } from "../login-link";
import { useMyBookmarkedSubjectIds, useToggleSubjectBookmark } from "../../queries/bookmarks";
import { useAuth } from "../../providers/auth-provider";
import { useIsDark } from "../../theme";

// 과목 즐겨찾기 별(웹 subject-bookmark-button.tsx). 상태 정본은 ['me',u,'subject-bookmarks']
// 캐시 — 초성 모달·과목 페이지·+패널 어디서 눌러도 /papers 의 "즐겨찾기한 과목만 보기"
// 결과가 곧바로 따라간다(웹의 onToggled 콜백 전파를 캐시가 대신한다).
export function SubjectBookmarkButton({
  subjectId,
  size = "md",
  onToggled,
}: {
  subjectId: string;
  // 과목 인덱스 모달처럼 좁은 자리에 넣을 때는 "sm"으로 줄인다.
  size?: "sm" | "md";
  // 즐겨찾기 상태가 바뀔 때(낙관적 반영) 부모에 알린다 — /papers 가 페이지를 1로 되돌리는 데 쓴다.
  onToggled?: (bookmarked: boolean) => void;
}) {
  const { userId } = useAuth();
  const current = useCurrentHref();
  const dark = useIsDark();
  const { set } = useMyBookmarkedSubjectIds();
  const toggle = useToggleSubjectBookmark();
  const bookmarked = set.has(subjectId);
  const pending = toggle.isPending && toggle.variables?.subjectId === subjectId;

  function onPress() {
    if (!userId) {
      router.push(loginHref(current));
      return;
    }
    const next = !bookmarked;
    onToggled?.(next);
    toggle.mutate({ subjectId, next });
  }

  const iconSize = size === "sm" ? 14 : 18;
  const color = bookmarked ? (dark ? "#ffb900" : "#fd9a00") : dark ? "#9f9fa9" : "#52525c";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={bookmarked ? "과목 즐겨찾기 해제" : "과목 즐겨찾기 추가"}
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
      <Star size={iconSize} color={color} fill={bookmarked ? color : "none"} />
    </Pressable>
  );
}
