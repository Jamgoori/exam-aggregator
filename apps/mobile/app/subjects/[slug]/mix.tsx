import { subjectColor } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { ChevronRight, Shuffle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { AppText } from "../../../src/components/app-text";
import { MixPracticeStarter } from "../../../src/components/mix/mix-practice-starter";
import { MixSessionList } from "../../../src/components/mix/mix-session-list";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { useMixOverview, useMixSessions } from "../../../src/queries/mix";
import NotFoundScreen from "../../+not-found";
import { themedIcon } from "../../../src/theme/icons";

// 기출 섞어풀기 시작 화면(웹 app/subjects/[slug]/mix/page.tsx 1:1). 메뉴 허브(/mix)·과목 화면의
// "기출 섞어풀기" 버튼·오답노트에서 들어온다. 고를 것은 급수·연도·문항 수뿐이고, 나머지(시행처,
// 순서, 안 푼 문제 우선, 개념 분산)는 기본값으로 흡수한다.
//
// 로그인 전에도 화면은 보인다(웹과 같다). 요약을 주는 EF `mix-create {action:"overview"}` 는
// 정답을 싣지 않는 공개 통계라 인증 앞에 있고, 게스트도 문항 수·급수·연도까지 그대로 본 뒤
// "시작"에서만 로그인으로 간다(뭘 하는 기능인지 먼저 닿아야 로그인할 이유가 생긴다) — 막는
// 자리는 패널 하나뿐이다. 아래 "최근 섞어풀기 기록"은 본인 것이라 로그인한 사람에게만 뜬다
// (useMixSessions 가 enabled 로 조회를 막아 게스트에게는 빈 목록이다).
const ShuffleIcon = themedIcon(Shuffle);
const ChevronIcon = themedIcon(ChevronRight);

export default function SubjectMixScreen() {
  const params = useLocalSearchParams<{ slug: string; level?: string }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const levelRaw = Array.isArray(params.level) ? params.level[0] : params.level;
  const level = levelRaw && levelRaw.length > 0 ? levelRaw : null;

  if (!slug) return <NotFoundScreen />;
  return <SubjectMixBody slug={slug} level={level} />;
}

function SubjectMixBody({ slug, level }: { slug: string; level: string | null }) {
  const overview = useMixOverview(slug);
  const sessions = useMixSessions(slug);

  return (
    <Screen
      contentClassName="gap-6"
      refreshing={overview.isRefetching}
      onRefresh={() => void overview.refetch()}
    >
      <BackLink slug={slug} name={overview.data?.subject.name} />

      <QueryState query={overview} skeleton={<MixStarterSkeleton />}>
        {(data) => {
          const { subject } = data;
          const examTypesLabel =
            data.examTypeNames.length > 4
              ? `${data.examTypeNames.slice(0, 4).join("·")} 등 ${data.examTypeNames.length}개 시험`
              : data.examTypeNames.join("·");
          const yearsLabel =
            data.minYear && data.maxYear
              ? data.minYear === data.maxYear
                ? `${data.maxYear}년`
                : `${data.minYear}~${data.maxYear}년`
              : null;
          const color = subjectColor(subject.slug);
          const recent = sessions.data ?? [];

          return (
            <>
              <View className="gap-3">
                <View className="flex-row flex-wrap items-center gap-2">
                  <View className={["rounded px-2 py-0.5", color].join(" ")}>
                    <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
                      {subject.name}
                    </AppText>
                  </View>
                </View>
                <View className="flex-row items-center gap-2">
                  <ShuffleIcon size={22} colorClassName="text-blue-600 dark:text-blue-400" />
                  <AppText variant="2xl" weight="semibold" accessibilityRole="header" className="min-w-0 flex-1" pretty>
                    {subject.name} 기출 섞어풀기
                  </AppText>
                </View>
                <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" pretty>
                  {examTypesLabel ? `${examTypesLabel}의 ` : ""}
                  {subject.name} 기출을 시험 구분 없이 한 번에 섞어서 풀어요.
                  {yearsLabel ? ` ${yearsLabel} 문제지 ${data.paperCount}장,` : ""} 풀 수 있는 문항{" "}
                  <AppText variant="sm" weight="semibold" className="text-zinc-800 dark:text-zinc-200">
                    {data.questionCount.toLocaleString()}개
                  </AppText>
                  .
                </AppText>
              </View>

              <View className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4 dark:border-blue-900/50 dark:bg-blue-950/25">
                <MixPracticeStarter
                  subjectSlug={subject.slug}
                  subjectName={subject.name}
                  questionCount={data.questionCount}
                  levelGroups={data.levelGroups}
                  initialLevel={level}
                  cells={data.cells}
                  minYear={data.minYear}
                  maxYear={data.maxYear}
                />
              </View>

              <HowItWorks subjectName={subject.name} />

              {recent.length > 0 && (
                <View className="gap-3">
                  <View className="flex-row items-center justify-between gap-2">
                    <AppText variant="base" weight="semibold">
                      최근 섞어풀기 기록
                    </AppText>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push(`/mypage/wrong-notes/${slug}` as Href)}
                      hitSlop={6}
                      className="flex-row items-center gap-0.5"
                    >
                      <AppText variant="sm" weight="medium" className="text-blue-600 dark:text-blue-400">
                        오답노트에서 전체 보기
                      </AppText>
                      <ChevronIcon size={14} colorClassName="text-blue-600 dark:text-blue-400" />
                    </Pressable>
                  </View>
                  <MixSessionList subjectSlug={slug} sessions={recent.slice(0, 3)} />
                </View>
              )}
            </>
          );
        }}
      </QueryState>
    </Screen>
  );
}

function BackLink({ slug, name }: { slug: string; name?: string }) {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.navigate(`/subjects/${slug}` as Href)}
      hitSlop={6}
      className="self-start"
    >
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
        ← {name ? `${name} 기출문제` : "과목 기출문제"}
      </AppText>
    </Pressable>
  );
}

// 시작 화면 아래 네 줄(웹과 같은 문구·같은 순서). 설정으로 노출하지 않은 규칙(안 푼 문제 우선,
// 개념 분산)을 여기서 말로 알린다.
function HowItWorks({ subjectName }: { subjectName: string }) {
  const lines = [
    "문제를 풀 때는 어느 시험 몇 번인지 보이지 않아요. 채점 후에 출처가 열려요.",
    `채점하면 오답노트 > ${subjectName}에 “○월 ○일 섞어풀기”로 남고, 틀린 문제는 해설과 함께 과목 오답에 합쳐져요.`,
    "다음에 또 시작하면 아직 안 풀어 본 문제부터 나와요. 과목 기출을 한 바퀴 다 돌면 그때부터 다시 섞여요.",
    "같은 개념(예: 행정법의 처분성)이 한 번에 몰리지 않게 골라요. 한 세션에 여러 개념을 고르게 만나야 시험처럼 풀 수 있어요.",
  ];
  return (
    <View className="gap-1.5">
      {lines.map((line, i) => (
        <View key={line} className="flex-row gap-2">
          <AppText variant="sm" className="shrink-0 text-blue-600 dark:text-blue-400">
            {i + 1}
          </AppText>
          <AppText variant="sm" className="min-w-0 flex-1 text-zinc-600 dark:text-zinc-400" pretty>
            {line}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function MixStarterSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-2">
        <Skeleton className="h-8 w-2/3 rounded-lg" />
        <Skeleton className="h-4 w-full rounded" />
      </View>
      <Skeleton className="h-64 w-full rounded-2xl" />
    </View>
  );
}
