import { filterBlocked } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { PencilLine } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { BoardCategoryTabs } from "../../src/components/board/board-category-tabs";
import { BoardListRow } from "../../src/components/board/board-list-row";
import { boardNewLoginHref } from "../../src/components/board/board-login";
import { BoardSearch } from "../../src/components/board/board-search";
import { Pagination } from "../../src/components/pagination";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSetScreenParams } from "../../src/lib/screen-params";
import { useAvatarUrls } from "../../src/queries/avatars";
import { useBlockedIds, useBoardPage, type BoardPage } from "../../src/queries/board";
import { useAuth } from "../../src/providers/auth-provider";
import { themedIcon } from "../../src/theme/icons";

// `/board?page&category&q`(설계서 §5 행, O) — 웹 app/board/page.tsx + board-search.tsx 이식.
//
// 비회원도 읽을 수 있게 열어둔다(웹 머리말) — 커뮤니티는 "먼저 구경하고 그 다음 가입"이 자연스러운
// 순서라, 목록부터 로그인을 요구하면 아무도 두 번째 화면을 못 본다. 글쓰기·댓글·좋아요에서만 로그인을
// 받는다. 쿼리 파라미터는 웹 주소 그대로 라우트 params 로 받는다(딥링크·알림 링크가 이 모양으로 온다).
//
// 차단(앱 전용, §6.7 #18): 차단한 사용자의 글은 고정글·일반글 모두 core filterBlocked 로 여기서 뺀다.
// 서버 RLS 는 건드리지 않으므로 "전체 N건"은 웹처럼 서버가 센 값(차단 글 포함)이다.
const PencilIcon = themedIcon(PencilLine);

type Params = { page?: string; category?: string; q?: string };

export default function BoardScreen() {
  const params = useLocalSearchParams<Params>();
  const setScreenParams = useSetScreenParams();
  const { userId } = useAuth();
  const page = Math.max(1, Number(params.page) || 1);
  const category = params.category || undefined;
  const keyword = (params.q ?? "").trim();

  const query = useBoardPage({ page, category, q: keyword });
  const { ids: blockedIds } = useBlockedIds();
  // 아바타는 고정글 + 일반글 작성자를 **한 번에**(N+1 금지). 비로그인은 훅이 돌지 않아 첫 글자 아바타.
  const authorIds = useMemo(
    () => [...(query.data?.pinnedItems ?? []), ...(query.data?.items ?? [])].map((item) => item.authorId),
    [query.data],
  );
  const avatars = useAvatarUrls(authorIds).data ?? {};

  // 말머리 탭·검색을 바꾸면 1페이지로(웹은 링크 자체가 page 없는 주소다). 빈 값은 파라미터를 지운다.
  function go(next: { category?: string; q?: string; page?: number }) {
    setScreenParams({
      category: next.category || undefined,
      q: next.q || undefined,
      page: next.page && next.page > 1 ? String(next.page) : undefined,
    });
  }

  function openWrite() {
    // `/board/new` 는 L(그 화면이 useRequireLogin 으로 다시 확인한다). 게스트는 웹 /board/new 가 로그인으로
    // 보내는 것처럼 바로 로그인 모달로 — error 문구도 웹 redirect 와 같은 문장(board-login.ts).
    router.push(userId ? ("/board/new" as Href) : boardNewLoginHref());
  }

  return (
    <Screen contentClassName="gap-5" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View className="gap-2">
        <AppText variant="2xl" weight="bold" accessibilityRole="header">
          자유게시판
        </AppText>
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400" pretty>
          같은 시험을 준비하는 사람들과 이야기를 나눠보세요. 공부법·시험 정보·합격수기 무엇이든 좋아요.
        </AppText>
      </View>

      <BoardCategoryTabs category={category} onChange={(next) => go({ category: next, q: keyword })} />

      {/* 웹 `flex-col gap-3 sm:flex-row` — 폰 폭이라 세로. */}
      <View className="gap-3">
        <BoardSearch initialQuery={keyword} onSubmit={(q) => go({ category, q })} />
        <Pressable
          accessibilityRole="button"
          onPress={openWrite}
          className="flex-row items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 py-2.5 active:bg-blue-700"
        >
          <PencilIcon size={16} colorClassName="text-white" />
          <AppText variant="sm" weight="bold" className="text-white">
            글쓰기
          </AppText>
        </Pressable>
      </View>

      <QueryState query={query} isEmpty={() => false} skeleton={<BoardListSkeleton />}>
        {(data) => (
          <BoardListBody
            data={data}
            keyword={keyword}
            blockedIds={blockedIds}
            avatars={avatars}
            page={page}
            onPage={(next) => go({ category, q: keyword, page: next })}
            onWrite={openWrite}
          />
        )}
      </QueryState>
    </Screen>
  );
}

function BoardListBody({
  data,
  keyword,
  blockedIds,
  avatars,
  page,
  onPage,
  onWrite,
}: {
  data: BoardPage;
  keyword: string;
  blockedIds: ReadonlySet<string>;
  avatars: Record<string, string>;
  page: number;
  onPage: (next: number) => void;
  onWrite: () => void;
}) {
  const pinned = filterBlocked(data.pinnedItems, blockedIds);
  const items = filterBlocked(data.items, blockedIds);
  const rows = [...pinned, ...items];

  return (
    <>
      <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400">
        {keyword ? (
          <>
            <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-200">
              &ldquo;{keyword}&rdquo;
            </AppText>{" "}
            검색 결과 {data.total}건
          </>
        ) : (
          <>
            전체{" "}
            <AppText variant="xs" weight="semibold" className="text-zinc-700 dark:text-zinc-200">
              {data.total}
            </AppText>
            건
          </>
        )}
      </AppText>

      <View className="overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        {rows.length === 0 && (
          <View className="items-center gap-2 px-4 py-16">
            <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400">
              {keyword ? "검색 결과가 없어요." : "아직 올라온 글이 없어요."}
            </AppText>
            {!keyword && (
              <Pressable accessibilityRole="link" onPress={onWrite} hitSlop={6}>
                <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
                  첫 글을 남겨보세요 →
                </AppText>
              </Pressable>
            )}
          </View>
        )}
        {rows.map((item, i) => (
          <BoardListRow key={item.id} item={item} avatarUrl={(item.authorId !== null && avatars[item.authorId]) || null} divider={i > 0} />
        ))}
      </View>

      <Pagination currentPage={page} totalPages={data.totalPages} onChange={onPage} />
    </>
  );
}

// 웹 board/loading.tsx 의 목록 부분(머리·탭·검색은 데이터와 무관해 바로 그린다): 건수 한 줄 + 카드 6장.
function BoardListSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-24" />
      <View className="gap-px overflow-hidden rounded-2xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-none" delay={150 + i * 50} />
        ))}
      </View>
    </>
  );
}
