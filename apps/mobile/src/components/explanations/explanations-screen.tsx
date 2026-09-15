import {
  examTypeColor,
  FREE_EXPLANATION_DAILY_PAPERS,
  getPaperDisplayTitle,
  getSubjectDisplayName,
  groupRowsBySharedImages,
  levelColor,
  subjectColor,
  type ExamPaper,
  type ExplanationsGetResponse,
} from "@gongmoa/core";
import { router, type Href } from "expo-router";
import { Hourglass, LockKeyhole, Monitor } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { ExplanationCard } from "./explanation-card";
import { MembershipUpsell } from "./membership-upsell";
import { AppText } from "../app-text";
import { Button } from "../button";
import { loginHref } from "../login-link";
import { QueryState } from "../query-state";
import { Screen } from "../screen";
import { Skeleton } from "../skeleton";
import { paperCbtHref, paperExplanationsHref, paperHref } from "../../lib/paper-href";
import { usePaperExplanations } from "../../queries/explanations";
import { themedIcon } from "../../theme/icons";

// 문제지 전체 해설 페이지(웹 app/papers/[id]/explanations/page.tsx, 설계서 §4.5 #24·§5 행).
// 데이터는 EF explanations-get 페이지 모드(queries/explanations.ts — 화면당 호출 1회).
// 비로그인·rate-limit 은 서버가 미리보기 문항만 내려준다(나머지는 응답에 없다).
// 인쇄(print-button·?download=1)는 §1 비목표라 그 자리를 비운다.
const HourglassIcon = themedIcon(Hourglass);
const LockKeyholeIcon = themedIcon(LockKeyhole);

function goBackToPaper(paper: ExamPaper) {
  if (router.canGoBack()) router.back();
  else router.replace(paperHref(paper) as Href);
}

export function ExplanationsScreen({ paper }: { paper: ExamPaper }) {
  const query = usePaperExplanations(paper.id);
  return (
    <Screen padded={false} contentClassName="gap-8 px-4 py-12">
      <QueryState query={query} skeleton={<ExplanationsSkeleton />} isEmpty={(d) => d.totalCount === 0} empty={<ExplanationsEmpty paper={paper} />}>
        {(data) => <ExplanationsBody paper={paper} data={data} />}
      </QueryState>
    </Screen>
  );
}

function ExplanationsEmpty({ paper }: { paper: ExamPaper }) {
  return (
    <View className="max-w-lg items-center gap-4 self-center px-4 py-24">
      <AppText variant="xl" weight="semibold" className="text-center">
        아직 해설이 등록되지 않은 문제지예요
      </AppText>
      <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
        해설이 준비되면 이곳에서 문항별 해설을 볼 수 있어요.
      </AppText>
      <Button label="문제지로 돌아가기" onPress={() => goBackToPaper(paper)} className="px-5" textClassName="font-medium" />
    </View>
  );
}

function ExplanationsBody({ paper, data }: { paper: ExamPaper; data: ExplanationsGetResponse }) {
  const displayTitle = getPaperDisplayTitle(paper.title, paper.track);
  const subject = paper.subjects;
  const examType = paper.exam_types;
  const { hasFullAccess, loggedIn, lockReason, remainingToday, hiddenCount, totalCount } = data;

  // 열람용 화면이라 "내가 고른 답" 개념이 없다 — selectedChoice 는 항상 비워둔다.
  const groups = useMemo(
    () => groupRowsBySharedImages(data.questions.map((q) => ({ ...q, selectedChoice: null }))),
    [data.questions],
  );
  const explanationsHref = paperExplanationsHref(paper);

  return (
    <>
      <View className="gap-3">
        <Pressable accessibilityRole="link" onPress={() => goBackToPaper(paper)} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 문제지로
          </AppText>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2">
          {paper.level && <SmallBadge cls={levelColor(paper.level)} label={paper.level} bold />}
          {examType && <SmallBadge cls={examTypeColor(examType.name)} label={examType.name} bold />}
          {subject && (
            <SmallBadge
              cls={subjectColor(subject.slug)}
              label={getSubjectDisplayName(subject.name, examType?.name, paper.level, paper.track)}
            />
          )}
        </View>

        <AppText variant="2xl" weight="semibold" className="leading-snug" pretty>
          {displayTitle} 해설
        </AppText>

        <View className="flex-row flex-wrap items-center gap-3">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            {totalCount}문항 해설
          </AppText>
          <View className="flex-row items-center gap-1">
            <View className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
              정답
            </AppText>
          </View>
          {/* PrintButton 자리(웹 "인쇄본에는 해설만 담겨요") — 앱 비목표라 비운다. */}
        </View>

        {/* 무료 회원에게만 오늘 남은 몫을 알린다. 유료·관리자·비로그인은 null 이라 이 줄이 없다. */}
        {hasFullAccess && remainingToday != null && (
          <View className="flex-row flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-400" pretty>
              오늘 남은 무료 해설{" "}
              <AppText variant="xs" weight="bold" className="text-zinc-700 dark:text-zinc-200">
                {remainingToday}개
              </AppText>{" "}
              · 오늘 열어본 문제지는 다시 봐도 차감되지 않아요
            </AppText>
            <Pressable accessibilityRole="link" onPress={() => router.push("/membership" as Href)} hitSlop={6}>
              <AppText variant="xs" weight="medium" className="text-blue-600 dark:text-blue-400">
                제한 없이 보기 →
              </AppText>
            </Pressable>
          </View>
        )}

        {paper.question_count != null && totalCount < paper.question_count && (
          <View className="rounded-lg bg-amber-50 px-3 py-2 dark:bg-amber-950/30">
            <AppText variant="xs" className="text-amber-700 dark:text-amber-400" pretty>
              일부 문항({paper.question_count - totalCount}개)의 해설은 아직 준비 중이에요.
            </AppText>
          </View>
        )}
      </View>

      <View className="gap-4">
        {groups.map((group) => (
          <ExplanationCard key={group.rows[0].questionNumber} rows={group.rows} images={group.images} explanationsOpen showSelection={false} />
        ))}
      </View>

      {!hasFullAccess && hiddenCount > 0 && lockReason === "free-quota" && (
        <MembershipUpsell
          title="오늘 무료로 볼 수 있는 해설을 다 봤어요"
          description={`무료 회원은 하루에 문제지 ${FREE_EXPLANATION_DAILY_PAPERS}개까지 해설을 볼 수 있어요. 오늘 이미 열어본 문제지는 계속 다시 볼 수 있고, 매일 자정(한국 시간)에 다시 ${FREE_EXPLANATION_DAILY_PAPERS}개가 열려요. 멤버십은 해설을 제한 없이 볼 수 있어요.`}
          next={explanationsHref}
        />
      )}

      {!hasFullAccess && hiddenCount > 0 && lockReason !== "free-quota" && (
        <View className="items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-6 py-10 dark:border-blue-900 dark:bg-blue-950/30">
          {loggedIn ? (
            <>
              {/* 시간당 한도 초과: 로그인은 돼 있으니 "잠시 후"로만 안내 — 무료 한도와 절대 섞지 않는다. */}
              <HourglassIcon size={28} colorClassName="text-blue-600 dark:text-blue-400" />
              <AppText weight="semibold" className="text-center">
                잠시 후 다시 시도해주세요
              </AppText>
              <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
                요청이 많아 전체 해설 표시가 일시적으로 제한됐어요.
              </AppText>
            </>
          ) : (
            <>
              <LockKeyholeIcon size={28} colorClassName="text-blue-600 dark:text-blue-400" />
              <AppText weight="semibold" className="text-center" pretty>
                나머지 {hiddenCount}문항 해설은 로그인하면 볼 수 있어요
              </AppText>
              <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
                무료로 가입하고 전체 해설과 오답노트까지 이용해보세요.
              </AppText>
              <Button
                label="로그인하고 전체 해설 보기"
                onPress={() => router.push(loginHref(explanationsHref) as Href)}
                className="mt-1 px-6"
                textClassName="font-medium"
              />
            </>
          )}
        </View>
      )}

      <View className="flex-row gap-2">
        <Button
          label="온라인에서 풀기"
          icon={<Monitor size={15} color="#ffffff" />}
          onPress={() => router.push(paperCbtHref(paper) as Href)}
          className="flex-1"
          textClassName="font-medium"
        />
        <Button variant="outline" label="문제지로" onPress={() => goBackToPaper(paper)} className="flex-1" textClassName="font-medium" />
      </View>
    </>
  );
}

function SmallBadge({ cls, label, bold }: { cls: string; label: string; bold?: boolean }) {
  return (
    <View className={["rounded px-2 py-0.5", cls].join(" ")}>
      <AppText variant="xs" weight={bold ? "bold" : "medium"} allowFontScaling={false} className={cls}>
        {label}
      </AppText>
    </View>
  );
}

// 웹 explanations/loading.tsx.
function ExplanationsSkeleton() {
  return (
    <View className="gap-8">
      <View className="gap-3">
        <Skeleton className="h-4 w-20 rounded-lg" />
        <View className="flex-row gap-2">
          <Skeleton className="h-5 w-10 rounded" />
          <Skeleton className="h-5 w-14 rounded" />
          <Skeleton className="h-5 w-14 rounded" />
        </View>
        <Skeleton className="h-8 w-full max-w-md rounded-lg" />
        <Skeleton className="h-4 w-32 rounded-lg" />
      </View>
      <View className="gap-4">
        {[0, 1].map((i) => (
          <View key={i} className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
            <View className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 dark:border-zinc-700 dark:bg-zinc-800/50">
              <Skeleton className="h-4 w-12 rounded-lg" delay={i * 120} />
            </View>
            <Skeleton className="h-48 w-full rounded-none" delay={i * 120} />
            <View className="flex-row items-center gap-1.5 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
              {Array.from({ length: 4 }, (_, j) => (
                <Skeleton key={j} className="h-9 w-9 rounded-full" delay={i * 120} />
              ))}
            </View>
            <View className="gap-2 border-t border-zinc-100 px-4 py-3 dark:border-zinc-700">
              <Skeleton className="h-4 w-20 rounded-lg" delay={i * 120} />
              <Skeleton className="h-20 w-full rounded-lg" delay={i * 120} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
