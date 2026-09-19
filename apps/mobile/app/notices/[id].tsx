import type { NoticeViewer } from "@gongmoa/core";
import { router, useLocalSearchParams } from "expo-router";
import { Pin } from "lucide-react-native";
import { useEffect, useMemo, useRef } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../+not-found";
import { AppText } from "../../src/components/app-text";
import { InlineAlert } from "../../src/components/feedback";
import { NoticeComments } from "../../src/components/notices/notice-comments";
import { formatNoticeDateTime } from "../../src/components/notices/notice-format";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { countNoticeView, useNotice, useNoticeComments, type NoticeDetail } from "../../src/queries/notices";
import { useAuth } from "../../src/providers/auth-provider";
import { themedIcon } from "../../src/theme/icons";

// `/notices/[id]`(설계서 §5 행, O — 댓글은 L) — 웹 app/notices/[id]/page.tsx + notice-comments.tsx 이식.
// 블록 순서도 웹과 같다: "← 공지사항" → 머리(고정 배지·제목·날짜·조회) → 본문 → 댓글.
//
// 본문은 **서식 없는 텍스트**다 — 웹이 `whitespace-pre-wrap` 인 p 하나로 그리고 RichTextContent 를 쓰지
// 않는다(공지는 운영자가 쓰는 평문). 관리자용 수정·삭제 버튼은 앱에 없다(§5 — 관리자 화면 미이식).
const PinIcon = themedIcon(Pin);

export default function NoticeRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = typeof params.id === "string" ? params.id : undefined;
  const notice = useNotice(id);

  // 순서(§6.9): 스켈레톤 → InlineAlert+재시도 → 없으면 404(웹 notFound) → 본문.
  if (notice.isPending) {
    return (
      <Screen contentClassName="gap-6">
        <NoticeSkeleton />
      </Screen>
    );
  }
  if (notice.isError) {
    return (
      <Screen contentClassName="gap-6">
        <InlineAlert
          message={notice.error instanceof Error ? notice.error.message : "공지를 불러오지 못했어요."}
          onRetry={() => void notice.refetch()}
        />
      </Screen>
    );
  }
  if (!notice.data) return <NotFoundScreen />;
  return <NoticeScreen notice={notice.data} isRefetching={notice.isRefetching} refetch={() => void notice.refetch()} />;
}

function NoticeScreen({ notice, isRefetching, refetch }: { notice: NoticeDetail; isRefetching: boolean; refetch: () => void }) {
  const { userId, isAdmin } = useAuth();
  const viewer: NoticeViewer = useMemo(() => ({ userId, isAdmin }), [userId, isAdmin]);
  const comments = useNoticeComments(notice.id);

  // 조회수(웹 countNoticeView — Promise.all 안에서 댓글과 함께, 한 번). 웹은 화면에 **증가 전** 값을
  // 보여주므로(같은 렌더에서 읽은 값) 여기서도 캐시를 올리지 않는다. 공지는 게스트도 세므로(RPC anon
  // 허용) 세션 판정을 기다리지 않는다.
  const counted = useRef<string | null>(null);
  useEffect(() => {
    if (counted.current === notice.id) return;
    counted.current = notice.id;
    void countNoticeView(notice.id);
  }, [notice.id]);

  return (
    <Screen
      contentClassName="gap-6"
      refreshing={isRefetching}
      onRefresh={() => {
        refetch();
        void comments.refetch();
      }}
    >
      <Pressable accessibilityRole="link" onPress={() => router.navigate("/notices")} hitSlop={6} className="self-start">
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
          ← 공지사항
        </AppText>
      </Pressable>

      <View className="gap-4">
        <View className="gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
          {notice.isPinned && (
            <View className="self-start flex-row items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 dark:bg-amber-950/40">
              <PinIcon size={11} colorClassName="text-amber-700 dark:text-amber-400" />
              <AppText variant="11" weight="medium" allowFontScaling={false} className="text-amber-700 dark:text-amber-400">
                고정
              </AppText>
            </View>
          )}

          <AppText variant="xl" weight="bold" accessibilityRole="header" pretty>
            {notice.title}
          </AppText>

          <View className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
            <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
              {formatNoticeDateTime(notice.createdAt)}
            </AppText>
            <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500">
              조회 {String(notice.viewCount)}
            </AppText>
          </View>
        </View>

        {/* 웹 `min-h-24 text-sm leading-7 whitespace-pre-wrap text-zinc-700` — RN Text 는 개행을 그대로 그린다. */}
        <AppText variant="sm" className="min-h-24 leading-7 text-zinc-700 dark:text-zinc-200" pretty>
          {notice.content}
        </AppText>
      </View>

      <View className="border-t border-zinc-200 pt-6 dark:border-zinc-700">
        {comments.isPending ? (
          <View className="gap-3">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-20 rounded-lg" delay={80} />
            <Skeleton className="h-14 rounded-lg" delay={160} />
          </View>
        ) : comments.isError ? (
          <InlineAlert
            message={comments.error instanceof Error ? comments.error.message : "댓글을 불러오지 못했어요."}
            onRetry={() => void comments.refetch()}
          />
        ) : (
          <NoticeComments noticeId={notice.id} comments={comments.data} viewer={viewer} />
        )}
      </View>
    </Screen>
  );
}

// 머리(배지·제목·날짜 줄) + 본문 자리. 웹에는 상세 loading.tsx 가 없어 목록 스켈레톤 구도를 따랐다.
function NoticeSkeleton() {
  return (
    <>
      <Skeleton className="h-4 w-16" />
      <View className="gap-2 border-b border-zinc-200 pb-4 dark:border-zinc-700">
        <Skeleton className="h-5 w-12 rounded-full" delay={50} />
        <Skeleton className="h-7 w-full" delay={100} />
        <Skeleton className="h-3 w-40" delay={150} />
      </View>
      <Skeleton className="h-24 w-full rounded-xl" delay={200} />
    </>
  );
}
