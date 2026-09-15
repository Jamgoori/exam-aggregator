import type { ExamCombo, Subject } from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { ArrowRight, ChevronRight } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { HomeSearchBox } from "./home-search-box";
import { ExamComboCardsSkeleton } from "./home-skeletons";
import { AppText } from "../app-text";
import { QueryState } from "../query-state";
import { useHomeLanding } from "../../queries/home";
import { palette } from "../../theme";
import { themedIcon } from "../../theme/icons";

// 기출문제 찾기(웹 page.tsx PastQuestions): 검색창 + 시험(시행처+급수) 카드 6장.
//
// 여섯 장은 고정이다("처음 온 사람이 찾는 순"): 지방직·국가직 9급이 절대다수, 그다음 7급,
// 경찰·소방은 시행처 자체가 시험명, 법원직은 별도 과목 체계라 따로 찾는다. 건수·연도만 실제
// 색인(core buildExamIndex)에서 채우고, 색인에 없는 시험은 카드를 그리지 않는다.
// 배지 색: 경찰은 제복의 청색, 소방은 적색. 나머지는 홈 팔레트(웹 FEATURED_EXAMS 그대로).
//
// 카드의 목적지: 웹은 시험 허브(/exams/[exam])인데 앱은 Phase 2 라 아직 없다 — 같은 시험만
// 남긴 기출문제 목록(/papers?type=시행처&level=급수)으로 보낸다(PapersBrowser 가 두 필터를
// 함께 적용한다). /exams 가 붙으면 examHref 로 바꾼다.
const FEATURED_EXAMS: { slug: string; badge: string; color: string }[] = [
  { slug: "지방직-9급", badge: "9급", color: palette.brand },
  { slug: "국가직-9급", badge: "9급", color: palette.navy },
  { slug: "국가직-7급", badge: "7급", color: "#5b21b6" },
  { slug: "경찰", badge: "경찰", color: "#1d4ed8" },
  { slug: "소방", badge: "소방", color: "#dc2626" },
  { slug: "법원직-9급", badge: "9급", color: "#92400e" },
];

const ChevronIcon = themedIcon(ChevronRight);
const ArrowIcon = themedIcon(ArrowRight);
// 카탈로그 도착 전 검색창에 넘길 빈 목록(렌더마다 새 배열을 만들면 추천 useMemo 가 헛돈다).
const EMPTY_SUBJECTS: Subject[] = [];
const EMPTY_NAMES: string[] = [];

function comboPapersHref(c: ExamCombo): Href {
  const params: Record<string, string> = { type: c.examTypeName };
  if (c.level) params.level = c.level;
  return { pathname: "/papers", params } as Href;
}

export function PastQuestions() {
  const { query, data } = useHomeLanding();
  return (
    <View className="px-4 py-16">
      <View className="gap-4">
        <View>
          <AppText variant="sm" weight="bold" className="text-[#12b382]">
            PAST QUESTIONS
          </AppText>
          <AppText variant="2xl" weight="bold" accessibilityRole="header" className="mt-2 tracking-tight text-zinc-900 dark:text-zinc-50">
            원하는 기출문제를 찾아보세요
          </AppText>
          <AppText variant="sm" className="mt-2 text-zinc-500 dark:text-zinc-400" pretty>
            국가직·지방직·경찰·소방 등 공무원 시험 기출문제를 한 곳에서
          </AppText>
        </View>
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/papers" as Href)}
          hitSlop={6}
          className="flex-row items-center gap-1 self-start"
        >
          <AppText variant="sm" weight="bold" className="text-[#012854] dark:text-emerald-300">
            전체 기출문제 보기
          </AppText>
          <ArrowIcon size={14} colorClassName="text-[#012854] dark:text-emerald-300" />
        </Pressable>
      </View>

      <HomeSearchBox subjects={data?.subjects ?? EMPTY_SUBJECTS} examTypeNames={data?.examTypeNames ?? EMPTY_NAMES} />

      <QueryState query={query} skeleton={<ExamComboCardsSkeleton />}>
        {() => {
          const bySlug = new Map((data?.combos ?? []).map((c) => [c.slug, c]));
          const featured = FEATURED_EXAMS.flatMap((f) => {
            const combo = bySlug.get(f.slug);
            return combo ? [{ ...f, combo }] : [];
          });
          return (
            <View className="mt-6 gap-3">
              {featured.map(({ slug, badge, color, combo: c }) => (
                <Pressable
                  key={slug}
                  accessibilityRole="link"
                  accessibilityLabel={`${c.label} 기출문제 ${c.count.toLocaleString("ko-KR")}개`}
                  onPress={() => router.push(comboPapersHref(c))}
                  className="flex-row items-center gap-4 rounded-xl border border-zinc-200 bg-white p-4 active:shadow-md dark:border-zinc-800 dark:bg-zinc-950"
                >
                  <View
                    className="h-11 w-11 shrink-0 items-center justify-center rounded-lg shadow-sm"
                    style={{ backgroundColor: color, shadowColor: color, shadowOpacity: 0.4, shadowRadius: 5, shadowOffset: { width: 0, height: 4 } }}
                  >
                    <AppText variant="sm" weight="bold" allowFontScaling={false} className="text-white">
                      {badge}
                    </AppText>
                  </View>
                  <View className="min-w-0 flex-1">
                    <AppText variant="sm" weight="bold" className="text-zinc-900 dark:text-zinc-100">
                      {c.label}
                    </AppText>
                    <AppText variant="xs" className="mt-1 text-zinc-500 dark:text-zinc-400">
                      기출문제 {c.count.toLocaleString("ko-KR")}개 · {c.years[c.years.length - 1]}~{c.years[0]}년
                    </AppText>
                  </View>
                  <ChevronIcon size={16} colorClassName="text-zinc-300" />
                </Pressable>
              ))}
            </View>
          );
        }}
      </QueryState>

      <View className="mt-5 flex-row flex-wrap gap-x-5 gap-y-2">
        <Pressable accessibilityRole="link" onPress={() => router.push("/exams" as Href)} hitSlop={6}>
          <AppText variant="sm" weight="semibold" className="text-[#012854] dark:text-emerald-300">
            시험별 전체 보기 →
          </AppText>
        </Pressable>
        <Pressable accessibilityRole="link" onPress={() => router.push("/subjects" as Href)} hitSlop={6}>
          <AppText variant="sm" weight="semibold" className="text-[#012854] dark:text-emerald-300">
            과목별 기출문제 →
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}
