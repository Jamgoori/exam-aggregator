import { filterBlocked } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { MessageSquarePlus } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { loginRedirectHref } from "../../src/components/mypage/require-login";
import { Pagination } from "../../src/components/pagination";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { SuggestionListRow } from "../../src/components/suggestions/suggestion-list-row";
import { useSetScreenParams } from "../../src/lib/screen-params";
import { useBlockedIds } from "../../src/queries/board";
import { useSuggestionPage, type SuggestionPage } from "../../src/queries/suggestions";
import { useAuth } from "../../src/providers/auth-provider";
import { themedIcon } from "../../src/theme/icons";

// `/suggestions?page`(설계서 §5 행, O) — 웹 app/suggestions/page.tsx 이식.
//
// 로그인 없이도 목록·공개글은 읽을 수 있게 두었다(웹 머리말) — "이미 올라온 건의가 있는지"를 확인하려고
// 들어오는 사람이 대부분이라, 여기서 로그인부터 요구하면 같은 건의가 중복으로 쌓인다. 글쓰기만 로그인을
// 받는다(비밀글의 '본인'을 특정해야 한다). 목록은 EF suggestions 가 뷰어 기준으로 마스킹해 준 값이다
// (queries/suggestions.ts 머리말 — 남의 비밀글은 제목이 이미 "비밀글입니다." 다).
//
// 폰 폭이라 웹의 sm 이상 전용 요소(번호 칸·표 머리)는 그리지 않는다 — 웹도 그 폭에서는 숨긴다.
//
// 차단(§6.7 #18): 차단한 사용자의 글은 고정글·일반글 모두 core filterBlocked 로 여기서 뺀다 — 게시판과 같은
// 자리. "전체 N건"은 웹처럼 서버가 센 값(차단 글 포함)이다.
const WriteIcon = themedIcon(MessageSquarePlus);

export default function SuggestionsScreen() {
  const params = useLocalSearchParams<{ page?: string }>();
  const setScreenParams = useSetScreenParams();
  const { userId } = useAuth();
  const page = Math.max(1, Number(params.page) || 1);

  const query = useSuggestionPage(page);
  const { ids: blockedIds } = useBlockedIds();

  function openWrite() {
    // `/suggestions/new` 는 L(그 화면이 useRequireLogin 으로 다시 확인한다). 게스트는 웹 /suggestions/new 가
    // 로그인으로 보내는 것처럼 바로 로그인 모달로 — 웹 redirect 에는 error 문구가 없어 앱 관례 문장을 쓴다.
    router.push(userId ? ("/suggestions/new" as Href) : loginRedirectHref("/suggestions/new"));
  }

  return (
    <Screen contentClassName="gap-6" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View className="gap-2">
        <AppText variant="2xl" weight="bold" accessibilityRole="header">
          건의게시판
        </AppText>
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400" pretty>
          불편한 점, 있었으면 하는 기능을 남겨주세요. 남에게 보이면 곤란한 내용은{" "}
          <AppText variant="sm" weight="medium" className="text-zinc-700 dark:text-zinc-200">
            비밀글
          </AppText>
          로 작성할 수 있어요.
        </AppText>
      </View>

      <QueryState query={query} isEmpty={() => false} skeleton={<SuggestionListSkeleton />}>
        {(data) => (
          <SuggestionListBody
            data={data}
            blockedIds={blockedIds}
            page={page}
            onPage={(next) => setScreenParams({ page: next > 1 ? String(next) : undefined })}
            onWrite={openWrite}
          />
        )}
      </QueryState>
    </Screen>
  );
}

function SuggestionListBody({
  data,
  blockedIds,
  page,
  onPage,
  onWrite,
}: {
  data: SuggestionPage;
  blockedIds: ReadonlySet<string>;
  page: number;
  onPage: (next: number) => void;
  onWrite: () => void;
}) {
  const rows = [...filterBlocked(data.pinnedItems, blockedIds), ...filterBlocked(data.items, blockedIds)];
  return (
    <>
      <View className="flex-row items-center justify-between">
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
          전체{" "}
          <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-200">
            {String(data.total)}
          </AppText>
          건
        </AppText>
        <Pressable
          accessibilityRole="button"
          onPress={onWrite}
          className="flex-row items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 active:bg-blue-700"
        >
          <WriteIcon size={16} colorClassName="text-white" />
          <AppText variant="sm" weight="medium" className="text-white">
            건의하기
          </AppText>
        </Pressable>
      </View>

      <View className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {rows.length === 0 && (
          <AppText variant="sm" className="px-4 py-16 text-center text-zinc-500 dark:text-zinc-400" pretty>
            아직 등록된 건의가 없어요. 첫 건의를 남겨보세요.
          </AppText>
        )}
        {rows.map((item, i) => (
          <SuggestionListRow key={item.id} item={item} divider={i > 0} />
        ))}
      </View>

      <Pagination currentPage={page} totalPages={data.totalPages} onChange={onPage} />
    </>
  );
}

// 웹 suggestions/loading.tsx 의 목록 부분(머리·설명은 데이터와 무관해 바로 그린다): 건수 줄 + 줄 여덟 개.
function SuggestionListSkeleton() {
  return (
    <>
      <View className="flex-row items-center justify-between">
        <Skeleton className="h-4 w-20" delay={100} />
        <Skeleton className="h-9 w-24 rounded-lg" delay={100} />
      </View>
      <View className="gap-px overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-14 rounded-none" delay={150 + i * 50} />
        ))}
      </View>
    </>
  );
}
