import { decodePapers, type MyAttemptRow } from "@gongmoa/core";
import { Star } from "lucide-react-native";
import { useMemo } from "react";
import { View } from "react-native";
import { FavoriteSubjectsEditor } from "./favorite-subjects-editor";
import { AppText } from "../app-text";
import { ExamCard, ExamCardSkeleton } from "../papers/exam-card";
import { QueryState } from "../query-state";
import { Skeleton } from "../skeleton";
import { useMyBookmarkedPaperIds } from "../../queries/bookmarks";
import { useCatalog } from "../../queries/catalog";

// "즐겨찾기" 탭(웹 mypage/page.tsx BookmarksTab:548): 즐겨찾는 과목 편집 영역 + 북마크한 문제지
// 카드 목록. 문제지 객체는 카탈로그(디스크 퍼시스트)에서 즐겨찾기 id(['me',u,'bookmarks'])로
// 고른다. 순서는 웹과 같이 북마크한 순(created_at desc) — 즐겨찾기 id 배열이 그 순서라 그대로
// 따른다. "바로 풀기"는 카탈로그 cbtMask, 회독 배지는 응시 목록.
export function BookmarksTab({ attemptsByPaper }: { attemptsByPaper: Map<string, MyAttemptRow[]> }) {
  const bookmarks = useMyBookmarkedPaperIds();
  const catalog = useCatalog();

  const bookmarkedIds = bookmarks.query.data;
  const papers = useMemo(() => {
    if (!catalog.data) return [];
    const decoded = decodePapers(catalog.data);
    const mask = catalog.data.cbtMask;
    const order = new Map((bookmarkedIds ?? []).map((id, i) => [id, i]));
    return decoded
      .map((p, i) => ({ paper: p, hasCbtAnswers: mask[i] === "1" }))
      .filter(({ paper }) => order.has(paper.id))
      .sort((a, b) => order.get(a.paper.id)! - order.get(b.paper.id)!);
  }, [catalog.data, bookmarkedIds]);

  return (
    <View className="gap-4">
      <QueryState query={catalog} skeleton={<Skeleton className="h-10 w-full rounded-xl" />}>
        {(data) => <FavoriteSubjectsEditor subjects={data.subjects} />}
      </QueryState>

      <View className="flex-row items-center gap-2">
        <Star size={18} color="#ffb900" />
        <AppText variant="lg" weight="semibold">
          즐겨찾기한 문제 ({papers.length})
        </AppText>
      </View>

      <QueryState query={bookmarks.query} skeleton={<BookmarksSkeleton />}>
        {() => (
          <QueryState query={catalog} skeleton={<BookmarksSkeleton />}>
            {() =>
              papers.length === 0 ? (
                <AppText variant="sm" className="py-12 text-center text-zinc-500 dark:text-zinc-500" pretty>
                  아직 즐겨찾기한 문제가 없어요. 문제 상세 페이지에서 북마크 아이콘을 눌러보세요.
                </AppText>
              ) : (
                <View className="gap-4">
                  {papers.map(({ paper, hasCbtAnswers }) => (
                    <ExamCard
                      key={paper.id}
                      paper={paper}
                      myRoundCount={attemptsByPaper.get(paper.id)?.length}
                      isBookmarked
                      hasCbtAnswers={hasCbtAnswers}
                    />
                  ))}
                </View>
              )
            }
          </QueryState>
        )}
      </QueryState>
    </View>
  );
}

function BookmarksSkeleton() {
  return (
    <View className="gap-4">
      <ExamCardSkeleton />
      <ExamCardSkeleton delay={120} />
    </View>
  );
}
