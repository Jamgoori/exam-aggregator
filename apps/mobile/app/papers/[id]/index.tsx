import {
  getPaperDocumentTitle,
  getSubjectDisplayName,
  levelColor,
  subjectColor,
  type ExamPaper,
} from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { BookOpenCheck, Download, ExternalLink, Monitor } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../../src/components/app-text";
import { Skeleton } from "../../../src/components/skeleton";
import { BookmarkButton } from "../../../src/components/papers/bookmark-button";
import { CommentsSection } from "../../../src/components/papers/comments-section";
import { DifficultyRating } from "../../../src/components/papers/difficulty-rating";
import { MyPaperHistory } from "../../../src/components/papers/my-paper-history";
import { PaperGate } from "../../../src/components/papers/paper-gate";
import { parseExamTypesParam } from "../../../src/components/papers/paper-filter-chips";
import { RelatedPapersSection } from "../../../src/components/papers/related-papers";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { paperCbtHref, paperExplanationsHref, paperHref } from "../../../src/lib/paper-href";
import { usePaperMyDetail, usePaperPublicDetail } from "../../../src/queries/papers";
import { useAuth } from "../../../src/providers/auth-provider";
import { themedIcon } from "../../../src/theme/icons";

// `/papers/[id]`(설계서 §5 행) — 웹 app/papers/[id]/page.tsx 의 블록을 같은 순서로:
// 크럼 → 배지+즐겨찾기 → 제목·메타·태그 → 열기 버튼들(온라인에서 풀기·문제·정답·해설) →
// 내 시험 기록 → 체감 난이도 → 댓글 → (AdBanner: Phase 5) → 같은 과목 목록.
// 문제·정답 열기/다운로드는 전부 앱 내 PDF 뷰어(`/papers/[id]/pdf?kind=`)로 — 웹 /download/*
// 는 부르지 않는다(AGENTS.md). "해설 다운로드"(?download=1 인쇄)는 §1 비목표라 아이콘을 비운다.
const MonitorIcon = Monitor;
const ExternalLinkIcon = themedIcon(ExternalLink);
const DownloadIcon = themedIcon(Download);
const BookIcon = themedIcon(BookOpenCheck);

export default function PaperDetailRoute() {
  const params = useLocalSearchParams<{ id: string; level?: string; examTypes?: string }>();
  return (
    <PaperGate param={params.id} skeleton={<PaperDetailSkeleton />}>
      {(paper) => <PaperDetailScreen paper={paper} level={params.level || undefined} examTypesParam={params.examTypes} />}
    </PaperGate>
  );
}

function PaperDetailScreen({ paper, level, examTypesParam }: { paper: ExamPaper; level: string | undefined; examTypesParam?: string }) {
  const { userId } = useAuth();
  const loggedIn = !!userId;
  const publicDetail = usePaperPublicDetail(paper);
  const myDetail = usePaperMyDetail(paper);
  const selectedExamTypeIds = useMemo(() => parseExamTypesParam(examTypesParam), [examTypesParam]);

  const subject = paper.subjects;
  const examType = paper.exam_types;
  const displayTitle = getPaperDocumentTitle(paper.title, paper.track);
  const pdfHref = (kind: "paper" | "answer") => `${paperHref(paper)}/pdf?kind=${kind}` as Href;

  function setFilter(next: { level?: string; examTypes?: Set<string> }) {
    const nextLevel = "level" in next ? next.level : level;
    const nextTypes = next.examTypes ?? selectedExamTypeIds;
    router.setParams({
      level: nextLevel || undefined,
      examTypes: nextTypes.size > 0 ? [...nextTypes].join(",") : undefined,
    } as Record<string, string>);
  }

  const openBtn = (primary: boolean) =>
    primary
      ? "bg-blue-600 active:bg-blue-700"
      : "border border-blue-200 bg-blue-50 active:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40 dark:active:bg-blue-900/40";
  const openText = (primary: boolean) => (primary ? "text-white" : "text-blue-700 dark:text-blue-400");
  const iconBtn =
    "shrink-0 items-center justify-center rounded-xl border border-zinc-300 px-5 active:border-blue-300 active:bg-blue-50 dark:border-zinc-700 dark:active:border-blue-800 dark:active:bg-blue-950/40";

  return (
    <Screen contentClassName="gap-14" refreshing={publicDetail.isRefetching} onRefresh={() => void Promise.all([publicDetail.refetch(), myDetail.refetch()])}>
      <View className="gap-4">
        {/* 상위 계층으로 올라가는 링크(웹 breadcrumb). */}
        <View className="flex-row flex-wrap items-center gap-x-2">
          <Pressable accessibilityRole="link" onPress={() => router.navigate("/")} hitSlop={6}>
            <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
              ← 홈으로
            </AppText>
          </Pressable>
          {subject && (
            <>
              <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" accessibilityElementsHidden>
                ·
              </AppText>
              <Pressable accessibilityRole="link" onPress={() => router.push(`/subjects/${subject.slug}` as Href)} hitSlop={6}>
                <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
                  {subject.name} 기출문제
                </AppText>
              </Pressable>
            </>
          )}
        </View>

        <View className="flex-row items-center justify-between gap-4">
          <View className="min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
            {paper.level && (
              <View className={["rounded px-2 py-0.5", levelColor(paper.level)].join(" ")}>
                <AppText variant="xs" weight="bold" allowFontScaling={false} className={levelColor(paper.level)}>
                  {paper.level}
                </AppText>
              </View>
            )}
            {subject && (
              <View className={["rounded px-2 py-0.5", subjectColor(subject.slug)].join(" ")}>
                <AppText variant="xs" weight="medium" allowFontScaling={false} className={subjectColor(subject.slug)}>
                  {/* 이 문제지의 과목명이라 시행처·급수 표기를 따른다. */}
                  {getSubjectDisplayName(subject.name, examType?.name, paper.level, paper.track)}
                </AppText>
              </View>
            )}
          </View>
          <BookmarkButton paperId={paper.id} initialBookmarked={myDetail.data?.isBookmarked ?? false} />
        </View>

        <View>
          <AppText variant="27" weight="bold" className="leading-snug" pretty>
            {displayTitle}
          </AppText>
          <AppText variant="sm" className="mt-2 text-zinc-500 dark:text-zinc-500">
            {examType?.name}
            {examType?.name ? " · " : ""}
            {paper.year}년{paper.round > 1 ? ` · ${paper.round}회차` : ""}
            {paper.question_count ? ` · ${paper.question_count}문제` : ""}
          </AppText>
          {paper.tags.length > 0 && (
            <AppText variant="sm" className="mt-1 text-zinc-400 dark:text-zinc-600">
              {paper.tags.map((tag) => `#${tag}`).join(" ")}
            </AppText>
          )}
        </View>
      </View>

      <QueryState query={publicDetail} skeleton={<ActionsSkeleton />}>
        {(detail) => {
          const hasCbt = detail.hasCbtAnswers;
          return (
            <>
              <View className="gap-3">
                {/* 주 동선 "온라인에서 풀기"를 맨 위 + 단색으로. CBT 미지원이면 문제 열기가 단색을 물려받는다. */}
                {hasCbt && (
                  <>
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push(paperCbtHref(paper) as Href)}
                      className="flex-row items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-4 active:bg-blue-700"
                    >
                      <MonitorIcon size={20} color="#ffffff" />
                      <AppText variant="lg" weight="medium" className="text-white">
                        온라인에서 풀기
                      </AppText>
                    </Pressable>
                    <AppText variant="xs" className="-mt-1 text-center text-zinc-500 dark:text-zinc-500" pretty>
                      제출 즉시 채점 · 틀린 문제는 오답노트에 자동 저장{!loggedIn && " · 구글·카카오 1초 로그인"}
                    </AppText>
                  </>
                )}

                <View className="flex-row items-stretch gap-2">
                  <Pressable
                    accessibilityRole="link"
                    onPress={() => router.push(pdfHref("paper"))}
                    className={["flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-4", openBtn(!hasCbt)].join(" ")}
                  >
                    <ExternalLinkIcon size={20} colorClassName={openText(!hasCbt)} />
                    <AppText variant="lg" weight="medium" className={openText(!hasCbt)}>
                      문제 열기
                    </AppText>
                  </Pressable>
                  <Pressable accessibilityRole="link" accessibilityLabel="문제 다운로드" onPress={() => router.push(pdfHref("paper"))} className={iconBtn}>
                    <DownloadIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
                  </Pressable>
                </View>

                {detail.answerKey && (
                  <View className="flex-row items-stretch gap-2">
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push(pdfHref("answer"))}
                      className={["flex-1 flex-row items-center justify-center gap-2 rounded-xl px-4 py-4", openBtn(false)].join(" ")}
                    >
                      <ExternalLinkIcon size={20} colorClassName={openText(false)} />
                      <AppText variant="lg" weight="medium" className={openText(false)}>
                        정답 열기
                      </AppText>
                    </Pressable>
                    <Pressable accessibilityRole="link" accessibilityLabel="정답 다운로드" onPress={() => router.push(pdfHref("answer"))} className={iconBtn}>
                      <DownloadIcon size={20} colorClassName="text-zinc-600 dark:text-zinc-400" />
                    </Pressable>
                  </View>
                )}

                {/* 전 문항 해설이 준비된 문제지에만(로그인 사용자 — paper_explanation_counts 는 authenticated 전용). */}
                {myDetail.data?.hasFullExplanations && (
                  <View className="flex-row items-stretch gap-2">
                    <Pressable
                      accessibilityRole="link"
                      onPress={() => router.push(paperExplanationsHref(paper) as Href)}
                      className="flex-1 flex-row items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4 active:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:active:bg-emerald-900/40"
                    >
                      <BookIcon size={20} colorClassName="text-emerald-700 dark:text-emerald-400" />
                      <AppText variant="lg" weight="medium" className="text-emerald-700 dark:text-emerald-400">
                        해설 열기
                      </AppText>
                    </Pressable>
                    {/* "해설 다운로드"(인쇄) 아이콘 자리 — 앱 비목표. */}
                  </View>
                )}
              </View>

              {/* 내 시험 기록 — 기록이 없는 사람(비회원 포함)에게는 아무것도 그리지 않는다. */}
              <MyPaperHistory attempts={myDetail.data?.myCbtRecordItems ?? []} roundAverages={detail.roundAverages} />

              <DifficultyRating
                paperId={paper.id}
                averageScore={detail.averageScore}
                voteCount={detail.voteCount}
                loggedIn={loggedIn}
                myScore={myDetail.data?.myScore ?? null}
              />

              <CommentsSection paperId={paper.id} comments={detail.comments} currentUserId={userId} />
            </>
          );
        }}
      </QueryState>

      {/* AdBanner(paperDetail) 자리 — Phase 5(§12-2 14번). */}

      {subject && (
        <RelatedPapersSection
          paper={paper}
          subject={subject}
          level={level}
          selectedExamTypeIds={selectedExamTypeIds}
          onChangeLevel={(next) => setFilter({ level: next })}
          onChangeExamTypes={(next) => setFilter({ examTypes: next })}
        />
      )}
    </Screen>
  );
}

// 웹 papers/[id]/loading.tsx 상단부.
function PaperDetailSkeleton() {
  return (
    <View className="gap-14">
      <View className="gap-4">
        <Skeleton className="h-4 w-20 rounded-lg" />
        <View className="flex-row items-center justify-between gap-4">
          <View className="flex-row items-center gap-2">
            <Skeleton className="h-6 w-12 rounded" />
            <Skeleton className="h-6 w-16 rounded" />
          </View>
          <Skeleton className="h-9 w-9 rounded-full" />
        </View>
        <View className="gap-3">
          <Skeleton className="h-8 w-full max-w-md rounded-lg" />
          <Skeleton className="h-4 w-64 rounded-lg" />
          <Skeleton className="h-3 w-40 rounded-lg" />
        </View>
      </View>
      <ActionsSkeleton />
    </View>
  );
}

function ActionsSkeleton() {
  return (
    <View className="gap-3">
      <View className="flex-row items-stretch gap-2">
        <Skeleton className="h-16 flex-1 rounded-xl" />
        <Skeleton className="h-16 w-16 rounded-xl" />
      </View>
      <View className="flex-row items-stretch gap-2">
        <Skeleton className="h-16 flex-1 rounded-xl" delay={100} />
        <Skeleton className="h-16 w-16 rounded-xl" delay={100} />
      </View>
      <Skeleton className="h-16 w-full rounded-xl" delay={200} />
      <Skeleton className="h-16 w-full rounded-xl" delay={300} />
    </View>
  );
}
