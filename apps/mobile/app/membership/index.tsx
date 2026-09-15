import { FREE_UNTIL_LABEL, isFreeForAll, sanitizeNextPath } from "@gongmoa/core";
import { LinearGradient } from "expo-linear-gradient";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { Button } from "../../src/components/button";
import { FeatureTable } from "../../src/components/membership/feature-table";
import { MembershipFaq } from "../../src/components/membership/membership-faq";
import { MembershipStatus } from "../../src/components/membership/membership-status";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { resolveNextPath } from "../../src/lib/next-path";
import { useMembershipDays } from "../../src/queries/membership";
import { useAuth } from "../../src/providers/auth-provider";

// `/membership?next`(설계서 §5 행 O — 로그인 없이도 본다, §8.1). 웹 app/membership/page.tsx 에서
// 상태 필(CurrentStatus 6가지)·비교표(FEATURE_ROWS)·FAQ 부분집합만 옮긴다. **플랜 카드·가격·구매
// 버튼·웹 결제 안내·"내 결제 내역"·부가세 문구는 IAP 단계(Phase 5) 전까지 일절 그리지 않는다**
// (Apple 3.1.1/3.1.3). 전면 무료 기간에는 "지금은 전부 무료예요" + FREE_UNTIL_LABEL 이 첫 문장.
export default function MembershipScreen() {
  const params = useLocalSearchParams<{ next?: string }>();
  const { userId, loading, isPremium, isAdmin, membershipLoading } = useAuth();
  const { trialDaysLeft, attendanceDaysLeft } = useMembershipDays();
  const freeForAll = useMemo(() => isFreeForAll(), []);
  // 유도 배너가 실어 보낸 "원래 보던 곳". next 가 없거나 홈으로 떨어지면 되돌아가기 줄을 그리지 않는다.
  const backHref = params.next && sanitizeNextPath(params.next) !== "/" ? resolveNextPath(params.next) : null;

  return (
    <Screen contentClassName="gap-10 pb-16">
      {backHref && (
        <Pressable accessibilityRole="link" onPress={() => router.replace(backHref as Href)} hitSlop={6} className="-mb-6 self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 보던 화면으로
          </AppText>
        </Pressable>
      )}

      {/* 헤드라인. 이벤트 기간에는 이 페이지에 온 사람이 가장 먼저 알아야 할 사실이 "지금은 다
          열려 있다"라, 헤드라인부터 그 말을 한다. */}
      <View className="items-center gap-3">
        {freeForAll ? (
          <AppText variant="3xl" weight="extrabold" className="text-center leading-tight text-zinc-900 dark:text-zinc-100" pretty>
            지금은 전부 무료예요
          </AppText>
        ) : (
          <AppText variant="3xl" weight="extrabold" className="text-center leading-tight text-zinc-900 dark:text-zinc-100" pretty>
            한 번 틀린 문제,{"\n"}
            <AppText variant="3xl" weight="extrabold" className="text-blue-600 dark:text-blue-400">
              두 번은 안 틀리게
            </AppText>
          </AppText>
        )}
        {loading || (userId && membershipLoading) ? (
          <Skeleton className="h-6 w-48 rounded-full" />
        ) : (
          <MembershipStatus
            freeForAll={freeForAll}
            premium={isPremium}
            admin={isAdmin}
            daysLeft={trialDaysLeft}
            rewardDaysLeft={attendanceDaysLeft}
            loggedIn={!!userId}
          />
        )}
      </View>

      {/* 전면 무료 이벤트 배너. 날짜는 core FREE_UNTIL_LABEL 하나에서 온다. */}
      {freeForAll && (
        <LinearGradient
          colors={["#155dfc", "#4f39f6", "#7f22fe"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          className="gap-2 overflow-hidden rounded-2xl px-6 py-6"
        >
          <View className="self-start rounded-full bg-white/20 px-2.5 py-1">
            <AppText variant="11" weight="extrabold" allowFontScaling={false} className="tracking-wide text-white">
              전면 무료 이벤트
            </AppText>
          </View>
          <AppText variant="2xl" weight="extrabold" className="leading-tight text-white" pretty>
            {FREE_UNTIL_LABEL}까지{"\n"}멤버십 전 기능 무료
          </AppText>
          <AppText variant="sm" className="leading-6 text-white/85" pretty>
            로그인만 하면 AI 약점 진단 · 오답노트 · 해설까지 전부 열립니다 — 이미 가입하신 분들도 자동으로
            적용돼요.
          </AppText>
          {/* 이 배너를 읽은 사람의 다음 행동 하나. 비회원은 로그인(끝나면 문제지 목록), 회원은 바로 문제지 목록. */}
          <Button
            label={userId ? "문제 풀러 가기" : "로그인하고 시작하기"}
            onPress={() => router.push((userId ? "/papers" : `/login?next=${encodeURIComponent("/papers")}`) as Href)}
            className="mt-2 self-start rounded-xl bg-white px-5 py-2.5 active:bg-indigo-50"
            textClassName="text-indigo-700"
          />
        </LinearGradient>
      )}

      <View className="gap-4">
        <AppText variant="xl" weight="bold" className="text-zinc-900 dark:text-zinc-100">
          무료와 어떤 점이 다른가요
        </AppText>
        <FeatureTable />
      </View>

      <View className="gap-4">
        <AppText variant="xl" weight="bold" className="text-zinc-900 dark:text-zinc-100">
          자주 묻는 질문
        </AppText>
        <MembershipFaq />
      </View>
    </Screen>
  );
}
