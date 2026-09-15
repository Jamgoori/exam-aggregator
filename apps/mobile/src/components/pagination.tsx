import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "./app-text";
import { themedIcon } from "../theme/icons";

// 페이지네이션(웹 pagination.tsx 의 모바일 폭 = 항상 5블록). 링크 대신 onChange —
// 호출부가 navigation.setParams({ page }) 로 URL 파라미터를 바꾼다.
// 화살표: 웹 pagination.tsx(과목 페이지)는 Chevron 아이콘, exam-browser.tsx(/papers)는 `‹`/`›`
// 글자 — arrows 로 고른다.
const Prev = themedIcon(ChevronLeft);
const Next = themedIcon(ChevronRight);
const BLOCK_SIZE = 5;

export function Pagination({
  currentPage,
  totalPages,
  onChange,
  arrows = "icon",
}: {
  currentPage: number;
  totalPages: number;
  onChange: (page: number) => void;
  arrows?: "icon" | "text";
}) {
  if (totalPages <= 1) return null;

  const blockStart = Math.floor((currentPage - 1) / BLOCK_SIZE) * BLOCK_SIZE + 1;
  const blockEnd = Math.min(blockStart + BLOCK_SIZE - 1, totalPages);
  const prevBlockPage = blockStart - 1;
  const nextBlockPage = blockEnd + 1;
  const pages: number[] = [];
  for (let p = blockStart; p <= blockEnd; p++) pages.push(p);

  const arrowCls =
    "h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 active:border-blue-300 dark:border-zinc-700";

  return (
    <View className="flex-row items-center justify-center gap-1 pt-4" accessibilityRole="toolbar">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="이전 페이지 묶음"
        accessibilityState={{ disabled: prevBlockPage < 1 }}
        disabled={prevBlockPage < 1}
        onPress={() => onChange(Math.max(1, prevBlockPage))}
        className={[arrowCls, prevBlockPage < 1 ? "opacity-40" : ""].join(" ")}
      >
        {arrows === "text" ? (
          <AppText className="text-zinc-500 dark:text-zinc-500">‹</AppText>
        ) : (
          <Prev size={16} colorClassName="text-zinc-500" />
        )}
      </Pressable>

      {pages.map((p) => {
        const active = p === currentPage;
        return (
          <Pressable
            key={p}
            accessibilityRole="button"
            accessibilityLabel={`${p}페이지`}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(p)}
            className={[
              "h-9 w-9 items-center justify-center rounded-lg",
              active
                ? "bg-blue-600"
                : "border border-zinc-200 active:border-blue-300 dark:border-zinc-700",
            ].join(" ")}
          >
            <AppText
              variant="sm"
              weight="medium"
              tabular
              className={active ? "text-white" : "text-zinc-600 dark:text-zinc-400"}
            >
              {String(p)}
            </AppText>
          </Pressable>
        );
      })}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="다음 페이지 묶음"
        accessibilityState={{ disabled: nextBlockPage > totalPages }}
        disabled={nextBlockPage > totalPages}
        onPress={() => onChange(Math.min(totalPages, nextBlockPage))}
        className={[arrowCls, nextBlockPage > totalPages ? "opacity-40" : ""].join(" ")}
      >
        {arrows === "text" ? (
          <AppText className="text-zinc-500 dark:text-zinc-500">›</AppText>
        ) : (
          <Next size={16} colorClassName="text-zinc-500" />
        )}
      </Pressable>
    </View>
  );
}
