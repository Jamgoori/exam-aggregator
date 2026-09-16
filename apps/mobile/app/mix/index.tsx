import {
  compareLevels,
  levelColor,
  subjectColor,
  KST_TIME_ZONE,
  MIX_NO_LEVEL,
  type MixCreateHubResponse,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ChevronRight, Shuffle } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { LoginPrompt } from "../../src/components/login-prompt";
import { MixSubjectPicker } from "../../src/components/mix/mix-subject-picker";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useCatalog } from "../../src/queries/catalog";
import { useMyBookmarkedSubjectIds } from "../../src/queries/bookmarks";
import { useMixHub, useRecentMixSessions } from "../../src/queries/mix";
import { useAuth } from "../../src/providers/auth-provider";
import { themedIcon } from "../../src/theme/icons";

// 메뉴(드로어)의 "섞어풀기" 입구 — 웹 app/mix/page.tsx 1:1. 섞어풀기는 과목 하나를 정해야 시작할
// 수 있으므로 이 화면은 급수와 과목만 묻는다(문항 수·연도는 다음 화면).
//
// 급수를 여기서 먼저 고르는 이유: 공시생은 자기 급수가 바뀌지 않는다. 과목을 옮길 때마다 9급을
// 다시 고르게 하면 매번 같은 선택을 반복시키는 셈이라, 여기서 한 번 고르면 과목 시작 화면까지
// 그대로 이어진다(?level=). 웹은 그 값이 주소에 실리지만 앱에서는 화면 상태로 든다 — 뒤로가기
// 한 번에 급수 선택이 통째로 사라지지 않게(웹은 히스토리 항목이 하나씩 쌓인다).
//
// **웹과 다른 점**: 웹은 비로그인에게도 목록을 보여준다. 앱의 통로인 EF `mix-create` 는
// hub·overview 까지 `requireUser` 뒤에 있어(내용은 공개 통계지만) 게스트에게는 로그인 안내를
// 대신 그린다. 없는 숫자를 지어내지 않는다.
const ShuffleIcon = themedIcon(Shuffle);
const ChevronIcon = themedIcon(ChevronRight);

const INTRO =
  "급수와 과목을 고르면 그 과목 기출을 국가직·지방직·경찰·소방 구분 없이 섞어서 풀어요. 연도·문항 수는 다음 화면에서 고르고, 결과는 오답노트에 날짜별로 남아요.";

export default function MixHubScreen() {
  const { userId } = useAuth();
  const hub = useMixHub();
  const [level, setLevel] = useState<string | null>(null);

  const header = (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <ShuffleIcon size={22} colorClassName="text-blue-600 dark:text-blue-400" />
        <AppText variant="2xl" weight="semibold" accessibilityRole="header">
          기출 섞어풀기
        </AppText>
      </View>
      <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" pretty>
        {INTRO}
      </AppText>
    </View>
  );

  if (!userId) {
    return (
      <Screen contentClassName="gap-6">
        {header}
        <LoginPrompt message="섞어풀기는 로그인 후 이용할 수 있어요" />
      </Screen>
    );
  }

  return (
    <Screen contentClassName="gap-6" refreshing={hub.isRefetching} onRefresh={() => void hub.refetch()}>
      {header}
      <QueryState query={hub} skeleton={<MixHubSkeleton />}>
        {(index) => <MixHubBody index={index} level={level} onLevel={setLevel} />}
      </QueryState>
    </Screen>
  );
}

function MixHubBody({
  index,
  level,
  onLevel,
}: {
  index: MixCreateHubResponse;
  level: string | null;
  onLevel: (next: string | null) => void;
}) {
  const recent = useRecentMixSessions();
  const favorites = useMyBookmarkedSubjectIds();
  const catalog = useCatalog();

  // 급수 탭. 9급 → 7급 → … "기타"(승진시험처럼 어느 급수에도 안 묶이는 것)는 뒤로.
  const tiers = useMemo(
    () =>
      [...index.tiers].sort((a, b) => {
        if (a.key === MIX_NO_LEVEL) return 1;
        if (b.key === MIX_NO_LEVEL) return -1;
        return compareLevels(a.key, b.key);
      }),
    [index.tiers],
  );
  const tierLabel = (t: { key: string; approx: boolean }) =>
    t.key === MIX_NO_LEVEL ? "기타" : t.approx ? `${t.key} 수준` : t.key;
  const selectedTier = tiers.find((t) => t.key === level) ?? null;

  // 즐겨찾기는 과목 id 로 저장되는데 목록은 slug 축이라, 고른 id 만 slug 로 환원한다.
  // 과목 id↔slug 표는 이미 카탈로그에 있다(별도 왕복 없음).
  const favoriteIds = favorites.set;
  const favoriteSlugs = useMemo(() => {
    const subjects = catalog.data?.subjects;
    if (favoriteIds.size === 0 || !subjects) return new Set<string>();
    return new Set(subjects.filter((s) => favoriteIds.has(s.id)).map((s) => s.slug));
  }, [favoriteIds, catalog.data]);

  // 고른 급수의 문제지가 있는 과목만. 즐겨찾는 과목을 앞으로 — 공시생은 보통 5과목만 도는데
  // 목록에는 수십 과목이 있어, 즐겨찾기가 곧 "내 과목 목록"이다.
  const subjects = useMemo(
    () =>
      index.subjects
        .map((s) => ({ ...s, count: level ? (s.byTier[level] ?? 0) : s.count }))
        .filter((s) => s.count > 0)
        .sort((a, b) => {
          const fa = favoriteSlugs.has(a.slug) ? 0 : 1;
          const fb = favoriteSlugs.has(b.slug) ? 0 : 1;
          return fa - fb || a.name.localeCompare(b.name, "ko");
        }),
    [index.subjects, level, favoriteSlugs],
  );

  return (
    <>
      {tiers.length > 1 && (
        <View className="gap-2">
          <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
            급수
          </AppText>
          <View className="flex-row flex-wrap gap-2">
            <TierChip active={level === null} onPress={() => onLevel(null)} label="전체" activeClassName="bg-zinc-800 dark:bg-zinc-100" activeTextClassName="text-white dark:text-zinc-900" />
            {tiers.map((t) => (
              <TierChip
                key={t.key}
                active={level === t.key}
                onPress={() => onLevel(level === t.key ? null : t.key)}
                label={tierLabel(t)}
                activeClassName={t.key === MIX_NO_LEVEL ? "bg-zinc-500" : levelColor(t.key)}
                activeTextClassName={t.key === MIX_NO_LEVEL ? "text-white" : levelColor(t.key)}
              />
            ))}
          </View>
          <AppText variant="11" className="text-zinc-400 dark:text-zinc-600" pretty>
            {selectedTier
              ? `${tierLabel(selectedTier)} 문제지만 나오게 골랐어요. 과목을 고르면 이 급수가 그대로 이어져요.`
              : tiers.some((t) => t.approx)
                ? "경찰·소방·해경·계리직처럼 급수가 없는 시험은 난도가 비슷한 급수에 묶여 있어요(간부후보는 7급 수준, 승진시험은 기타)."
                : "급수를 고르면 과목 시작 화면까지 그대로 이어져요."}
          </AppText>
        </View>
      )}

      {/* 최근 기록·즐겨찾기는 곁다리다. 이 둘이 실패해도 본문(과목 목록)은 그대로 보여준다 —
          웹도 같은 이유로 두 조회만 catch 해서 빈 값으로 떨어뜨린다. */}
      {(recent.data?.length ?? 0) > 0 && (
        <View className="gap-2">
          <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
            최근 섞어풀기
          </AppText>
          <View className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            {(recent.data ?? []).map((s, i) => {
              const color = subjectColor(s.subjectSlug);
              return (
                <Pressable
                  key={s.id}
                  accessibilityRole="link"
                  onPress={() => router.push(`/mypage/wrong-notes/${s.subjectSlug}/mix/${s.id}` as Href)}
                  className={[
                    "flex-row items-center gap-2.5 px-4 py-2.5 active:bg-blue-50/50 dark:active:bg-blue-950/20",
                    i > 0 ? "border-t border-zinc-100 dark:border-zinc-700/70" : "",
                  ].join(" ")}
                >
                  <View className={["shrink-0 rounded px-1.5 py-0.5", color].join(" ")}>
                    <AppText variant="11" weight="medium" allowFontScaling={false} className={color}>
                      {s.subjectName}
                    </AppText>
                  </View>
                  <AppText variant="sm" weight="medium" numberOfLines={1} className="min-w-0 flex-1 text-zinc-700 dark:text-zinc-300">
                    {s.title}
                  </AppText>
                  <AppText variant="xs" className="shrink-0 text-zinc-500 dark:text-zinc-500">
                    {s.score}/{s.total}
                  </AppText>
                  <AppText variant="xs" className="shrink-0 text-zinc-400 dark:text-zinc-600">
                    {new Date(s.createdAt).toLocaleDateString("ko-KR", {
                      timeZone: KST_TIME_ZONE,
                      month: "numeric",
                      day: "numeric",
                    })}
                  </AppText>
                  <ChevronIcon size={14} colorClassName="text-zinc-300 dark:text-zinc-700" />
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View className="gap-3">
        <View className="flex-row items-center justify-between">
          <AppText variant="sm" weight="semibold" className="text-zinc-700 dark:text-zinc-300">
            과목 고르기
          </AppText>
          {favoriteSlugs.size > 0 && (
            <AppText variant="xs" className="text-zinc-400 dark:text-zinc-600">
              즐겨찾는 과목이 위에 있어요
            </AppText>
          )}
        </View>

        <MixSubjectPicker
          subjects={subjects.map((s) => ({
            slug: s.slug,
            name: s.name,
            count: s.count,
            favorite: favoriteSlugs.has(s.slug),
          }))}
          level={level}
          unit={index.unit}
          emptyMessage={
            level
              ? "이 급수에는 아직 기출문제가 없어요. 다른 급수를 골라보세요."
              : "아직 풀 수 있는 과목이 없어요."
          }
        />
      </View>
    </>
  );
}

function TierChip({
  active,
  onPress,
  label,
  activeClassName,
  activeTextClassName,
}: {
  active: boolean;
  onPress: () => void;
  label: string;
  activeClassName: string;
  activeTextClassName: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={[
        "rounded-full px-4 py-1.5",
        active ? activeClassName : "border border-zinc-200 active:border-zinc-400 dark:border-zinc-700 dark:active:border-zinc-600",
      ].join(" ")}
    >
      <AppText
        variant="sm"
        weight="medium"
        className={active ? activeTextClassName : "text-zinc-600 dark:text-zinc-400"}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

function MixHubSkeleton() {
  return (
    <View className="gap-6">
      <Skeleton className="h-9 w-full rounded-full" />
      <View className="gap-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-[68px] w-full rounded-xl" />
        ))}
      </View>
    </View>
  );
}
