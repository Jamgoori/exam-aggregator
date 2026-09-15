import { examTypeFilledColor, getPaperDisplayTitle, levelColor, type ExamPaper, type ExamType } from "@gongmoa/core";
import { Image } from "expo-image";
import { router, type Href } from "expo-router";
import { ChevronRight, MapPin, Monitor } from "lucide-react-native";
import { Pressable, View } from "react-native";
import { BookmarkButton } from "./bookmark-button";
import { AppText } from "../app-text";
import { TierBadge } from "../badge";
import { Skeleton } from "../skeleton";
import { paperCbtHref, paperHref } from "../../lib/paper-href";
import { themedIcon } from "../../theme/icons";

// 문제지 카드(웹 exam-card.tsx, 설계서 §4.5 #18). p-4 rounded-xl border, 시행처 마크 24,
// 시험유형 배지는 examTypeFilledColor(채움), 회독 배지 TierBadge, "바로 풀기"는 hasCbtAnswers
// 일 때만. 카드 전체가 Pressable(상세) — 즐겨찾기·바로 풀기는 안쪽 Pressable 이 먼저 받는다.
// 현재 카드(isCurrent)는 링크·즐겨찾기·회독 배지·하단 행을 모두 생략한다.

// 시행처 마크(웹 lib/exam-type-icons.ts 와 같은 표 — public/exam-types 를 assets 로 번들).
const EXAM_TYPE_ICONS: Record<string, number> = {
  국가직: require("../../../assets/exam-types/government.webp"),
  지방직: require("../../../assets/exam-types/government.webp"),
  기상직: require("../../../assets/exam-types/government.webp"),
  지역인재: require("../../../assets/exam-types/government.webp"),
  경력경쟁: require("../../../assets/exam-types/government.webp"),
  간호직: require("../../../assets/exam-types/government.webp"),
  경찰: require("../../../assets/exam-types/police.webp"),
  해경: require("../../../assets/exam-types/coastguard.webp"),
  소방: require("../../../assets/exam-types/fire.webp"),
  군무원: require("../../../assets/exam-types/military.webp"),
  법원직: require("../../../assets/exam-types/court.webp"),
  국회직: require("../../../assets/exam-types/assembly.webp"),
  계리직: require("../../../assets/exam-types/post.webp"),
  // 한능검(국사편찬위원회)도 정부상징을 쓴다 — 국가직·지방직과 같은 마크.
  한능검: require("../../../assets/exam-types/government.webp"),
};

export function examTypeIcon(name: string): number | null {
  return EXAM_TYPE_ICONS[name] ?? null;
}

// 카드가 실제로 읽는 필드만 요구한다. round 는 화면에 쓰지 않지만 주소를 만드는 데 필요하다.
export type ExamCardPaper = Pick<ExamPaper, "id" | "title" | "track" | "level" | "round"> & {
  exam_types?: Pick<ExamType, "id" | "name"> | null;
};

const ChevronIcon = themedIcon(ChevronRight);
const MonitorIcon = themedIcon(Monitor);

// 웹 카드 배지 `rounded px-2 py-0.5 text-xs font-bold` — 색 클래스는 core badge-classes.
function CardBadge({ colorClass, label }: { colorClass: string; label: string }) {
  return (
    <View className={["rounded px-2 py-0.5", colorClass].join(" ")}>
      <AppText variant="xs" weight="bold" allowFontScaling={false} className={colorClass}>
        {label}
      </AppText>
    </View>
  );
}

export function ExamCard({
  paper,
  isCurrent = false,
  myRoundCount,
  isBookmarked = false,
  hasCbtAnswers = false,
}: {
  paper: ExamCardPaper;
  isCurrent?: boolean;
  // 로그인한 사용자가 이 문제지를 CBT로 몇 번 풀었는지 (없으면 배지 자체를 안 보여줌)
  myRoundCount?: number;
  isBookmarked?: boolean;
  // CBT 정답이 등록돼 있어 "바로 풀기"로 온라인 응시로 바로 넘어갈 수 있는지
  hasCbtAnswers?: boolean;
}) {
  const examType = paper.exam_types;
  const icon = examType ? examTypeIcon(examType.name) : null;
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);
  const href = paperHref(paper);

  const box = [
    "relative flex-col gap-3 rounded-xl border p-4",
    isCurrent
      ? "border-2 border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
      : "border-zinc-200 active:border-blue-300 active:shadow-sm dark:border-zinc-700 dark:active:border-blue-700",
  ].join(" ");

  const body = (
    <>
      <View className="flex-row items-start justify-between gap-2">
        <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
          {icon != null && (
            // 시행처 마크. 옆의 직렬 배지가 같은 정보를 글자로 이미 말하고 있어 장식용.
            <Image source={icon} style={{ width: 24, height: 24 }} contentFit="contain" accessible={false} />
          )}
          {paper.level && <CardBadge colorClass={levelColor(paper.level)} label={paper.level} />}
          {examType && <CardBadge colorClass={examTypeFilledColor(examType.name)} label={examType.name} />}
          {!isCurrent && !!myRoundCount && <TierBadge round={myRoundCount} compact />}
        </View>

        {isCurrent ? (
          <View className="shrink-0 flex-row items-center gap-1 rounded-full bg-blue-600 px-2 py-0.5">
            <MapPin size={12} color="#ffffff" />
            <AppText variant="xs" weight="semibold" allowFontScaling={false} className="text-white">
              현재 보는 중
            </AppText>
          </View>
        ) : (
          <BookmarkButton paperId={paper.id} initialBookmarked={isBookmarked} size="sm" />
        )}
      </View>

      <AppText weight="medium" className="leading-snug" pretty>
        {displayTitle}
      </AppText>

      {!isCurrent && (
        <View className="mt-auto flex-row items-center border-t border-zinc-100 pt-3 dark:border-zinc-700">
          {hasCbtAnswers && (
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="바로 풀기"
              onPress={() => router.push(paperCbtHref(paper) as Href)}
              hitSlop={4}
              className="flex-row items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 active:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:active:bg-blue-900/40"
            >
              <MonitorIcon size={12} colorClassName="text-blue-700 dark:text-blue-400" />
              <AppText variant="xs" weight="medium" className="text-blue-700 dark:text-blue-400">
                바로 풀기
              </AppText>
            </Pressable>
          )}
          <View className="ml-auto flex-row items-center gap-1">
            <AppText variant="xs" weight="medium" className="text-blue-600 dark:text-blue-400">
              자세히 보기
            </AppText>
            <ChevronIcon size={14} colorClassName="text-blue-600 dark:text-blue-400" />
          </View>
        </View>
      )}
    </>
  );

  if (isCurrent) return <View className={box}>{body}</View>;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={displayTitle}
      onPress={() => router.push(href as Href)}
      hitSlop={4}
      className={box}
    >
      {body}
    </Pressable>
  );
}

// 웹 loading.tsx 의 ExamCardSkeleton 과 같은 모양.
export function ExamCardSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <View className="flex-col gap-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
      <View className="flex-row items-start justify-between gap-2">
        <View className="flex-row flex-wrap items-center gap-2">
          <Skeleton className="h-5 w-10 rounded" delay={delay} />
          <Skeleton className="h-5 w-14 rounded" delay={delay} />
        </View>
        <Skeleton className="h-7 w-7 shrink-0 rounded-full" delay={delay} />
      </View>
      <Skeleton className="h-4 w-full rounded-lg" delay={delay} />
      <View className="mt-auto flex-row items-center justify-between border-t border-zinc-100 pt-3 dark:border-zinc-700">
        <Skeleton className="h-5 w-16 rounded-full" delay={delay} />
        <Skeleton className="h-4 w-16 rounded-lg" delay={delay} />
      </View>
    </View>
  );
}
