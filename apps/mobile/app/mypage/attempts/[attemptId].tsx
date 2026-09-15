import {
  applyExamTypeSubjectName,
  examTypeColor,
  formatDuration,
  groupRowsBySharedImages,
  KST_TIME_ZONE,
  levelColor,
  subjectColor,
  wrongAnswerKey,
  type AttemptDetail,
} from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Monitor, PartyPopper } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { Button } from "../../../src/components/button";
import { MembershipUpsell } from "../../../src/components/explanations/membership-upsell";
import { LoginRequiredScreen, useRequireLogin } from "../../../src/components/mypage/require-login";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { WrongNoteLegend, WrongNoteQuestionCard } from "../../../src/components/wrong-notes/wrong-note-question-card";
import { paperCbtHref, paperHref } from "../../../src/lib/paper-href";
import { useAttemptDetail, useOwnWrongAnswers } from "../../../src/queries/attempts";
import { useAuth } from "../../../src/providers/auth-provider";

// `/mypage/attempts/[attemptId]`(설계서 §5 행, 웹 app/mypage/attempts/[attemptId]/page.tsx 1:1) —
// 내 시험 기록에서 회차 하나를 눌렀을 때 "그 회차에서 틀린 문제만" 모아보는 화면. 본인 응시만
// (RLS). 정답은 RPC own_wrong_answers(메모리 전용), 기본은 틀린 문항만·"전체 문항 보기" 토글(앱 추가).
//
// 해설: 웹은 service_role 로 해설 본문(프리미엄)·유무(무료 잠금 자리)를 받지만, 앱용
// `explanations-get context:"wrong-note"` 모드(설계서 §6.7 #7, Phase 2)는 아직 Edge 에 없다
// (supabase/functions/explanations-get 에 context 분기 없음) — 그때까지는 해설 자리에 안내 한 줄만.
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

const MonitorIcon = Monitor;

export default function AttemptWrongNoteRoute() {
  const params = useLocalSearchParams<{ attemptId: string }>();
  const attemptId = Array.isArray(params.attemptId) ? params.attemptId[0] : params.attemptId;
  const valid = !!attemptId && isUuid(attemptId);
  const { userId, loading } = useRequireLogin(`/mypage/attempts/${attemptId ?? ""}`);

  if (!valid) return <NotFoundScreen />;
  if (loading) return <Screen contentClassName="gap-8" />;
  if (!userId) return <LoginRequiredScreen />;
  return <AttemptScreen attemptId={attemptId} />;
}

function AttemptScreen({ attemptId }: { attemptId: string }) {
  const query = useAttemptDetail(attemptId);
  // 없거나 남의 응시(RLS 로 빈 결과) → 404(웹 notFound). Screen 안에 다시 Screen 을 두지 않는다.
  if (query.isSuccess && query.data === null) return <NotFoundScreen />;
  return (
    <Screen contentClassName="gap-8" refreshing={query.isRefetching} onRefresh={() => void query.refetch()}>
      <QueryState query={query} skeleton={<AttemptSkeleton />}>
        {(detail) => (detail ? <AttemptBody detail={detail} attemptId={attemptId} /> : null)}
      </QueryState>
    </Screen>
  );
}

function AttemptBody({ detail, attemptId }: { detail: AttemptDetail; attemptId: string }) {
  const { isPremium } = useAuth();
  const { attempt, paper, questions } = detail;
  const [showAll, setShowAll] = useState(false);
  const pct = attempt.totalQuestions > 0 ? Math.round((attempt.score / attempt.totalQuestions) * 100) : 0;
  const wrong = useMemo(() => questions.filter((q) => !q.isCorrect), [questions]);
  const shown = showAll ? questions : wrong;

  // 정답은 보이는 문항만(RPC 는 본인이 답한 문항만 돌려준다 — 이 화면의 문항은 전부 그렇다).
  const items = useMemo(
    () => (paper ? shown.map((q) => ({ paperId: paper.id, questionNumber: q.questionNumber })) : []),
    [paper, shown],
  );
  const answers = useOwnWrongAnswers(items);

  const groups = useMemo(
    () =>
      groupRowsBySharedImages(
        shown.map((q) => ({
          questionNumber: q.questionNumber,
          selectedChoice: q.selectedChoice,
          correctChoice: paper ? (answers.data?.[wrongAnswerKey(paper.id, q.questionNumber)] ?? null) : null,
          choiceCount: q.choiceCount,
          images: q.images,
        })),
      ),
    [shown, paper, answers.data],
  );

  const next = `/mypage/attempts/${attemptId}`;

  return (
    <>
      <View className="gap-3">
        <Pressable accessibilityRole="link" onPress={() => router.navigate("/mypage?tab=history" as Href)} hitSlop={6} className="self-start">
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 내 시험 기록으로
          </AppText>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2">
          {paper?.level && <BadgeBox cls={levelColor(paper.level)} label={paper.level} bold />}
          {paper?.exam_types && <BadgeBox cls={examTypeColor(paper.exam_types.name)} label={paper.exam_types.name} bold />}
          {paper?.subjects && <BadgeBox cls={subjectColor(paper.subjects.slug)} label={paper.subjects.name} />}
          <View className="rounded-full bg-zinc-100 px-2 py-0.5 dark:bg-zinc-800">
            <AppText variant="xs" weight="medium" allowFontScaling={false} className="text-zinc-500 dark:text-zinc-500">
              {attempt.round}회독
            </AppText>
          </View>
        </View>

        {paper ? (
          <Pressable accessibilityRole="link" onPress={() => router.push(paperHref(paper) as Href)}>
            <AppText variant="2xl" weight="semibold" className="leading-snug" pretty>
              {applyExamTypeSubjectName(paper.title)}
            </AppText>
          </Pressable>
        ) : (
          <AppText variant="2xl" weight="semibold" className="text-zinc-400 dark:text-zinc-600">
            삭제된 문제지
          </AppText>
        )}

        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
          {new Date(attempt.createdAt).toLocaleDateString("ko-KR", { timeZone: KST_TIME_ZONE })} 응시
          {attempt.durationSeconds != null && ` · ${formatDuration(attempt.durationSeconds)}`}
        </AppText>
      </View>

      <View className="flex-row flex-wrap gap-3">
        <View className="min-w-[7rem] flex-1 gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
            점수
          </AppText>
          <View className="flex-row items-baseline gap-1.5">
            <AppText variant="xl" weight="semibold" tabular>
              {pct}점
            </AppText>
            <AppText variant="xs" tabular className="text-zinc-400 dark:text-zinc-600">
              {attempt.score}/{attempt.totalQuestions}
            </AppText>
          </View>
        </View>
        <View className="min-w-[7rem] flex-1 gap-1 rounded-xl border border-zinc-200 px-4 py-3 dark:border-zinc-700">
          <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
            오답
          </AppText>
          <AppText
            variant="xl"
            weight="semibold"
            tabular
            className={wrong.length > 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}
          >
            {wrong.length}문제
          </AppText>
        </View>
      </View>

      {wrong.length === 0 && !showAll ? (
        <View className="items-center gap-3 rounded-xl border border-zinc-200 py-16 dark:border-zinc-700">
          <PartyPopper size={32} color="#fd9a00" />
          <AppText weight="semibold">이 회차는 모두 맞혔어요!</AppText>
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            복습할 오답이 없어요. 다음 회차도 파이팅!
          </AppText>
          {questions.length > 0 && (
            <Pressable accessibilityRole="button" onPress={() => setShowAll(true)} className="py-1">
              <AppText variant="xs" weight="medium" className="text-blue-600 dark:text-blue-400">
                전체 문항 보기
              </AppText>
            </Pressable>
          )}
        </View>
      ) : (
        <View className="gap-4">
          <View className="flex-row flex-wrap items-center justify-between gap-2">
            <AppText variant="lg" weight="semibold">
              {showAll ? `전체 문항 (${questions.length})` : `이 회차에서 틀린 문제 (${wrong.length})`}
            </AppText>
            <WrongNoteLegend />
          </View>
          {/* 앱 추가: 맞힌 문항까지 같이 보기(정오는 RLS 본인 행). */}
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: showAll }}
            onPress={() => setShowAll((v) => !v)}
            className="self-start rounded-full border border-zinc-200 px-3 py-1 active:border-blue-300 dark:border-zinc-700"
          >
            <AppText variant="xs" weight="medium" className="text-zinc-600 dark:text-zinc-400">
              {showAll ? "틀린 문항만 보기" : "전체 문항 보기"}
            </AppText>
          </Pressable>

          <View className="rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-800/50">
            <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500" pretty>
              문항 해설은 다음 단계에서 열려요. 문제지 해설 페이지에서는 지금도 볼 수 있어요.
            </AppText>
          </View>

          <View className="gap-4">
            {groups.map((group) => (
              <WrongNoteQuestionCard key={group.rows[0].questionNumber} rows={group.rows} images={group.images} explanationLockNext={next} />
            ))}
          </View>
          {!isPremium && (
            <MembershipUpsell
              title="이 문항들의 해설이 궁금하다면"
              description="멤버십은 해설을 제한 없이 볼 수 있고, 과목별 오답노트에 메모·다시 볼 문제를 붙여 복습 일정까지 이어갈 수 있어요."
              next={next}
            />
          )}
        </View>
      )}

      {paper && (
        <View className="flex-row gap-2">
          <Button
            label="다시 풀기"
            icon={<MonitorIcon size={15} color="#ffffff" />}
            onPress={() => router.push(paperCbtHref(paper) as Href)}
            className="flex-1"
            textClassName="font-medium"
          />
          <Button variant="outline" label="문제지 상세" onPress={() => router.push(paperHref(paper) as Href)} className="flex-1" textClassName="font-medium" />
        </View>
      )}
    </>
  );
}

function BadgeBox({ cls, label, bold = false }: { cls: string; label: string; bold?: boolean }) {
  return (
    <View className={["rounded px-2 py-0.5", cls].join(" ")}>
      <AppText variant="xs" weight={bold ? "bold" : "medium"} allowFontScaling={false} className={cls}>
        {label}
      </AppText>
    </View>
  );
}

function AttemptSkeleton() {
  return (
    <View className="gap-8">
      <View className="gap-3">
        <Skeleton className="h-4 w-28 rounded" />
        <View className="flex-row gap-2">
          <Skeleton className="h-5 w-10 rounded" delay={60} />
          <Skeleton className="h-5 w-14 rounded" delay={120} />
        </View>
        <Skeleton className="h-8 w-full rounded-lg" delay={180} />
        <Skeleton className="h-4 w-32 rounded" delay={240} />
      </View>
      <View className="flex-row gap-3">
        <Skeleton className="h-[4.5rem] flex-1 rounded-xl" />
        <Skeleton className="h-[4.5rem] flex-1 rounded-xl" delay={80} />
      </View>
      <Skeleton className="h-64 w-full rounded-xl" delay={160} />
    </View>
  );
}
