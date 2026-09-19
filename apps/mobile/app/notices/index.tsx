import { useLocalSearchParams } from "expo-router";
import { Megaphone } from "lucide-react-native";
import { View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { NoticeListRow } from "../../src/components/notices/notice-list-row";
import { Pagination } from "../../src/components/pagination";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSetScreenParams } from "../../src/lib/screen-params";
import { useNoticePage, type NoticePage } from "../../src/queries/notices";
import { themedIcon } from "../../src/theme/icons";

// `/notices?page`(설계서 §5 행, O) — 웹 app/notices/page.tsx + lib/notices.ts#fetchNoticePage 이식.
//
// 회원가입 없이도 전부 읽을 수 있는 공개 게시판이다(웹 머리말). 고정 공지는 1페이지 맨 위에만 따로 얹고,
// 그 아래 일반 글이 최신순으로 20건씩 온다. 웹의 "글쓰기" 버튼(관리자 전용)은 앱에 없다 — 원글 작성·수정
// 화면 자체가 앱 범위 밖이다(§5 "/notices/new, /notices/[id]/edit 없음(관리자 전용)").
//
// 폰 폭이라 웹의 sm 이상 전용 요소(번호 칸·표 머리)는 그리지 않는다 — 웹도 그 폭에서는 숨긴다.
const MegaphoneIcon = themedIcon(Megaphone);

export default function NoticesScreen() {
  const params = useLocalSearchParams<{ page?: string }>();
  const setScreenParams = useSetScreenParams();
  const page = Math.max(1, Number(params.page) || 1);

  const query = useNoticePage(page);

  return (
    <Screen contentClassName="gap-6" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <View className="gap-2">
        <View className="flex-row items-center gap-2">
          <MegaphoneIcon size={22} colorClassName="text-blue-600 dark:text-blue-400" />
          <AppText variant="2xl" weight="bold" accessibilityRole="header">
            공지사항
          </AppText>
        </View>
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400" pretty>
          공모아의 새 소식과 안내를 확인하세요.
        </AppText>
      </View>

      <QueryState query={query} isEmpty={() => false} skeleton={<NoticeListSkeleton />}>
        {(data) => (
          <NoticeListBody
            data={data}
            page={page}
            onPage={(next) => setScreenParams({ page: next > 1 ? String(next) : undefined })}
          />
        )}
      </QueryState>
    </Screen>
  );
}

function NoticeListBody({ data, page, onPage }: { data: NoticePage; page: number; onPage: (next: number) => void }) {
  const rows = [...data.pinnedItems, ...data.items];
  return (
    <>
      {/* 웹 "전체 N건" 줄 — 옆의 글쓰기 버튼(관리자)은 앱에 없어 줄 하나만 남는다. */}
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-400">
        전체{" "}
        <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-200">
          {String(data.grandTotal)}
        </AppText>
        건
      </AppText>

      <View className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {rows.length === 0 && (
          <AppText variant="sm" className="px-4 py-16 text-center text-zinc-500 dark:text-zinc-400">
            아직 등록된 공지가 없어요.
          </AppText>
        )}
        {rows.map((item, i) => (
          <NoticeListRow key={item.id} item={item} divider={i > 0} />
        ))}
      </View>

      <Pagination currentPage={page} totalPages={data.totalPages} onChange={onPage} />
    </>
  );
}

// 웹 notices/loading.tsx 의 목록 부분(머리·설명은 데이터와 무관해 바로 그린다): 건수 한 줄 + 줄 여덟 개.
function NoticeListSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-20" delay={100} />
      <View className="gap-px overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
        {Array.from({ length: 8 }, (_, i) => (
          <Skeleton key={i} className="h-12 rounded-none" delay={150 + i * 50} />
        ))}
      </View>
    </>
  );
}
