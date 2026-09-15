import { isAttendanceOpen, isFreeForAll } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../../src/components/app-text";
import { Avatar } from "../../../src/components/avatar";
import { AttendanceCard } from "../../../src/components/mypage/attendance-card";
import { BookmarksTab } from "../../../src/components/mypage/bookmarks-tab";
import { HistoryTab } from "../../../src/components/mypage/history-tab";
import { MyPageTabs, resolveMyPageTab, type MyPageTabKey } from "../../../src/components/mypage/mypage-tabs";
import { NextActionCard } from "../../../src/components/mypage/next-action-card";
import { LoginRequiredScreen, useRequireLogin } from "../../../src/components/mypage/require-login";
import { formatExpiry, StatsTiles } from "../../../src/components/mypage/stats-tiles";
import { WrongNotesTab } from "../../../src/components/mypage/wrong-notes-tab";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { useSetScreenParams } from "../../../src/lib/screen-params";
import { useAttendanceSummary } from "../../../src/queries/attendance";
import { useMembershipDays } from "../../../src/queries/membership";
import { useAttemptRounds, useDiagnosisEligibility, useMyAttempts, useStreakDays, useWeeklyDiagnosisStatus } from "../../../src/queries/mypage";
import { useUnresolvedBySubject, useWrongNoteGroups } from "../../../src/queries/wrong-notes";
import { useAuth } from "../../../src/providers/auth-provider";

// `/mypage?tab=wrong-notes|history|attendance|bookmarks`(설계서 §5 행, 웹 app/mypage/page.tsx 1:1).
// `?tab=` 이 정본 — 탭을 누르면 setParams 로 주소를 고친다(오답노트 하단 탭·드로어 링크가 같은
// 주소로 들어온다). 비로그인은 웹처럼 `/login?next=…&error=로그인이 필요해요`(require-login.tsx).
// 데이터: 응시 목록(스트릭·회독·시험기록·즐겨찾기 회독 배지) + 과목별 남은 오답 + 진단 자격 +
// 이번 주 진단 + 출석(열려 있을 때만) + 프리미엄이면 오답노트 그룹(극복 진행률). 멤버십은
// AuthProvider(EF membership-get) 값을 그린다.
export default function MypageScreen() {
  const params = useLocalSearchParams<{ tab?: string }>();
  const tab = resolveMyPageTab(params.tab);
  const next = params.tab ? `/mypage?tab=${encodeURIComponent(params.tab)}` : "/mypage";
  const { userId, loading } = useRequireLogin(next);

  if (loading) {
    return (
      <Screen contentClassName="gap-8">
        <HeaderSkeleton />
      </Screen>
    );
  }
  if (!userId) return <LoginRequiredScreen />;
  return <MypageBody tab={tab} />;
}

function MypageBody({ tab }: { tab: MyPageTabKey }) {
  const { nickname, avatarUrl, isPremium, isAdmin, membership, membershipLoading } = useAuth();
  const attempts = useMyAttempts();
  const unresolved = useUnresolvedBySubject();
  const eligibility = useDiagnosisEligibility();
  const weekly = useWeeklyDiagnosisStatus();
  const attendance = useAttendanceSummary();
  // 무거운 집계(극복 진행률)는 웹처럼 프리미엄에게만 돌린다.
  const groups = useWrongNoteGroups(attempts.data, isPremium);
  const { daysLeft } = useMembershipDays();
  const setScreenParams = useSetScreenParams();

  const { attemptsByPaper, roundNumberByAttemptId } = useAttemptRounds(attempts.data);
  const streakDays = useStreakDays(attempts.data);
  const now = useMemo(() => new Date(), []);
  const membershipExpiry = membership?.expiresAt ? formatExpiry(membership.expiresAt, now) : null;

  const refreshing = attempts.isRefetching || unresolved.query.isRefetching;
  function refetchAll() {
    void Promise.all([
      attempts.refetch(),
      unresolved.query.refetch(),
      eligibility.refetch(),
      weekly.refetch(),
      isAttendanceOpen() ? attendance.refetch() : Promise.resolve(),
    ]);
  }

  function selectTab(key: MyPageTabKey) {
    setScreenParams({ tab: key });
  }

  return (
    <Screen contentClassName="gap-8" refreshing={refreshing} onRefresh={refetchAll}>
      <View>
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 홈으로
          </AppText>
        </Pressable>
        {/* 프로필 사진을 이름 옆에 둔다 — 아바타를 누르면 내 정보 수정으로 간다(사진 변경은 Phase 4). */}
        <View className="mt-2 flex-row items-center gap-3">
          <Pressable accessibilityRole="link" accessibilityLabel="프로필 사진 변경" onPress={() => router.push("/mypage/edit" as Href)} className="rounded-full">
            <Avatar nickname={nickname} avatarUrl={avatarUrl} size="xl" />
          </Pressable>
          <View className="min-w-0 flex-1">
            <AppText variant="3xl" weight="semibold" pretty>
              {nickname}님의 마이페이지
            </AppText>
            <View className="mt-1 flex-row items-center gap-2">
              <Pressable accessibilityRole="link" onPress={() => router.push("/mypage/edit" as Href)} hitSlop={6}>
                <AppText variant="sm" className="text-blue-600 dark:text-blue-400">
                  내 정보 수정
                </AppText>
              </Pressable>
            </View>
          </View>
        </View>
      </View>

      <QueryState query={attempts} skeleton={<BodySkeleton />}>
        {(myAttempts) => (
          <>
            {/* 지금 이 사람이 할 다음 한 가지. 요약 타일 위에 두는 건 타일 넷을 읽고 나서
                "그래서 뭘 하지"가 남지 않게 하려는 것이다. */}
            <NextActionCard
              attemptCount={myAttempts.length}
              wrongCount={eligibility.data?.wrongCount ?? 0}
              weeklyStatus={weekly.data ?? null}
            />

            <StatsTiles
              attemptCount={myAttempts.length}
              streakDays={streakDays}
              totalUnresolved={unresolved.query.data ? unresolved.total : null}
              membership={{
                admin: isAdmin,
                premium: isPremium,
                freeForAll: isFreeForAll(now),
                daysLeft,
                expiryLabel: membershipExpiry,
                loading: membershipLoading,
              }}
            />

            <MyPageTabs value={tab} onChange={selectTab} />

            {tab === "wrong-notes" && (
              <QueryState query={unresolved.query} skeleton={<TabSkeleton />}>
                {(bySubject) => (
                  <WrongNotesTab
                    premium={isPremium}
                    groups={isPremium && groups.data ? groups.data : null}
                    unresolvedBySubject={bySubject}
                  />
                )}
              </QueryState>
            )}
            {tab === "history" && <HistoryTab attempts={myAttempts} roundNumberByAttemptId={roundNumberByAttemptId} />}
            {tab === "attendance" && isAttendanceOpen() && (
              <QueryState query={attendance} skeleton={<TabSkeleton />}>
                {(summary) => <AttendanceCard {...summary} />}
              </QueryState>
            )}
            {tab === "bookmarks" && <BookmarksTab attemptsByPaper={attemptsByPaper} />}
          </>
        )}
      </QueryState>
    </Screen>
  );
}

function HeaderSkeleton() {
  return (
    <View className="gap-3">
      <Skeleton className="h-4 w-16 rounded" />
      <View className="flex-row items-center gap-3">
        <Skeleton className="h-20 w-20 rounded-full" />
        <View className="flex-1 gap-2">
          <Skeleton className="h-8 w-3/4 rounded-lg" delay={80} />
          <Skeleton className="h-4 w-20 rounded" delay={160} />
        </View>
      </View>
    </View>
  );
}

// 웹 mypage/loading.tsx 와 같은 자리: 다음 행동 카드 → 타일 4 → 탭 → 목록.
function BodySkeleton() {
  return (
    <View className="gap-8">
      <Skeleton className="h-16 w-full rounded-xl" />
      <View className="flex-row flex-wrap gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[4.5rem] min-w-[7rem] flex-1 rounded-xl" delay={i * 80} />
        ))}
      </View>
      <View className="flex-row gap-1 border-b border-zinc-200 pb-3 dark:border-zinc-700">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-7 flex-1 rounded-full" delay={i * 80} />
        ))}
      </View>
      <TabSkeleton />
    </View>
  );
}

function TabSkeleton() {
  return (
    <View className="gap-3">
      <Skeleton className="h-6 w-32 rounded-lg" />
      <Skeleton className="h-16 w-full rounded-xl" delay={80} />
      <Skeleton className="h-16 w-full rounded-xl" delay={160} />
      <Skeleton className="h-16 w-full rounded-xl" delay={240} />
    </View>
  );
}
