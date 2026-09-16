import { applyExamTypeSubjectName, levelColor, subjectColor } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Monitor } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../../+not-found";
import { AppText } from "../../../../src/components/app-text";
import { MembershipUpsell } from "../../../../src/components/explanations/membership-upsell";
import { LoginRequiredScreen, useRequireLogin } from "../../../../src/components/mypage/require-login";
import { QueryState } from "../../../../src/components/query-state";
import { Screen } from "../../../../src/components/screen";
import { Skeleton } from "../../../../src/components/skeleton";
import {
  useWrongNoteDeletions,
  type WrongNoteDeletions,
} from "../../../../src/components/wrong-notes/wrong-note-mark-actions";
import { WrongNotePaperView } from "../../../../src/components/wrong-notes/wrong-note-paper-view";
import { paperCbtHref } from "../../../../src/lib/paper-href";
import { useAuth } from "../../../../src/providers/auth-provider";
import { usePaperRoundComparisons } from "../../../../src/queries/papers";
import { usePaperWrongNote, type PaperWrongNote } from "../../../../src/queries/wrong-notes";
import { themedIcon } from "../../../../src/theme/icons";

// `/mypage/wrong-notes/[slug]/[paperId]`(설계서 §5 행, 웹 .../[paperId]/page.tsx 1:1) — 문제지
// 하나의 오답노트: 회독별 점수 기록(스트립)과 틀린 문제·해설을 한 화면에서 본다. 기본은 모든
// 회독을 합친 "통합" 보기, 회독 칩을 누르면 그 회독만 필터된다.
//
// 오답노트는 무료다(회차 기록·틀린 문항·정답 표시·정리·다시 풀기). 멤버십은 두 가지에만 쓴다:
// 해설 본문(explanations-get context:"wrong-note")과 회독별 다른 회원 평균(§8.3) — 둘 다
// 무료 회원에게는 잠금 자리가 대신 들어간다.
const MonitorIcon = themedIcon(Monitor);

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default function PaperWrongNoteRoute() {
  const params = useLocalSearchParams<{ slug: string; paperId: string }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const paperId = (Array.isArray(params.paperId) ? params.paperId[0] : params.paperId) ?? "";
  const { userId, loading } = useRequireLogin(`/mypage/wrong-notes/${slug}/${paperId}`);

  // 오답노트 문제지 주소는 언제나 UUID 다(과목 화면의 카드가 paper.id 로 건다).
  if (!slug || !isUuid(paperId)) return <NotFoundScreen />;
  if (loading) return <Screen contentClassName="gap-6" />;
  if (!userId) return <LoginRequiredScreen />;
  return <PaperWrongNoteScreen slug={slug} paperId={paperId} />;
}

function PaperWrongNoteScreen({ slug, paperId }: { slug: string; paperId: string }) {
  const query = usePaperWrongNote(paperId);
  // 응시 기록이 없거나(웹 null) 다른 과목의 문제지 주소로 들어오면 404.
  const mismatched = query.isSuccess && query.data != null && query.data.paper.subjects?.slug !== slug;
  // 삭제 되돌리기 토스트는 뷰포트에 고정돼야 해서 Screen 의 overlay 슬롯으로 올린다
  // (src/components/screen.tsx ScreenOverlay 머리말) — 그 상태를 화면이 들고, 목록에는
  // 값으로 내려 준다. 훅 순서를 지키려고 조기 반환보다 먼저 부른다.
  const deletions = useWrongNoteDeletions<number>();
  if (query.isSuccess && (query.data === null || mismatched)) return <NotFoundScreen />;
  return (
    <Screen
      contentClassName="gap-6"
      overlay={deletions.toast()}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <QueryState query={query} skeleton={<PaperSkeleton />}>
        {(note) => (note ? <PaperWrongNoteBody slug={slug} note={note} deletions={deletions} /> : null)}
      </QueryState>
    </Screen>
  );
}

function PaperWrongNoteBody({
  slug,
  note,
  deletions,
}: {
  slug: string;
  note: PaperWrongNote;
  deletions: WrongNoteDeletions<number>;
}) {
  // membership-get 이 아직 안 돌아왔을 때 isPremium 은 false 다 — 그대로 그리면 프리미엄
  // 회원이 화면을 열 때마다 잠금·업셀이 한 번 번쩍인다. 멤버십을 아는 순간까지는 그 자리를
  // 비워 둔다(app/membership/index.tsx 와 같은 판단).
  const { isPremium, membershipLoading } = useAuth();
  const { paper, rounds, questions, unresolvedCount } = note;
  const subject = paper.subjects;
  const self = `/mypage/wrong-notes/${slug}/${paper.id}`;

  // 회독별 "다른 회원 평균 점수"는 멤버십 전용이라 무료 회원에게는 조회하지 않는다(rounds 를
  // 비워 쿼리를 끈다) — 화면에는 무엇이 잠겼는지 알리는 잠금 링크 한 줄이 대신 들어간다.
  const compareRounds = useMemo(
    () =>
      isPremium
        ? rounds.map((r) => ({ round: r.round, score: r.score, totalQuestions: r.totalQuestions }))
        : [],
    [isPremium, rounds],
  );
  const comparisons = usePaperRoundComparisons(paper.id, compareRounds);

  const subjectCls = subject ? subjectColor(subject.slug) : "";
  const levelCls = paper.level ? levelColor(paper.level) : "";

  return (
    <>
      <View className="gap-3">
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate(`/mypage/wrong-notes/${slug}` as Href)}
          hitSlop={6}
          className="self-start"
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← {subject?.name ?? "과목"} 오답노트로
          </AppText>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2">
          {subject && (
            <View className={["rounded px-2 py-0.5", subjectCls].join(" ")}>
              <AppText variant="xs" weight="medium" allowFontScaling={false} className={subjectCls}>
                {subject.name}
              </AppText>
            </View>
          )}
          {paper.level && (
            <View className={["rounded px-2 py-0.5", levelCls].join(" ")}>
              <AppText variant="xs" weight="bold" allowFontScaling={false} className={levelCls}>
                {paper.level}
              </AppText>
            </View>
          )}
        </View>

        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <AppText variant="2xl" weight="semibold" accessibilityRole="header" className="min-w-0 flex-1 leading-snug" pretty>
            {applyExamTypeSubjectName(paper.title)}
          </AppText>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="이 문제지 다시 풀기"
            onPress={() => router.push(paperCbtHref(paper) as Href)}
            className="shrink-0 flex-row items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 active:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40"
          >
            <MonitorIcon size={12} colorClassName="text-blue-700 dark:text-blue-400" />
            <AppText variant="xs" weight="medium" className="text-blue-700 dark:text-blue-400">
              다시 풀기
            </AppText>
          </Pressable>
        </View>
      </View>

      {/* premium 이 멤버십을 모르는 동안 프리미엄 쪽인 이유: 회독 평균 비교는 비교 데이터가
          없으면 아무것도 그리지 않으므로(round-average-compare.tsx) 그 자리가 비어 있다가
          채워질 뿐이고, false 로 두면 잠금 링크가 한 번 번쩍인 뒤 표로 바뀐다. */}
      <WrongNotePaperView
        paperId={paper.id}
        questions={questions}
        rounds={rounds}
        unresolvedCount={unresolvedCount}
        lockNext={self}
        roundComparisons={comparisons.data ?? []}
        premium={isPremium || membershipLoading}
        deletions={deletions}
      />

      {!membershipLoading && !isPremium && (
        <MembershipUpsell
          title="해설까지 보면서 복습하려면"
          description="멤버십은 문항별 해설과 회독별 다른 회원 평균 점수를 볼 수 있고, 언제 다시 볼지 계산해주는 복습 일정까지 이어져요."
          next={self}
        />
      )}
    </>
  );
}

function PaperSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Skeleton className="h-4 w-32 rounded" />
        <View className="flex-row gap-2">
          <Skeleton className="h-5 w-14 rounded" delay={60} />
          <Skeleton className="h-5 w-10 rounded" delay={120} />
        </View>
        <Skeleton className="h-8 w-full rounded-lg" delay={180} />
      </View>
      <View className="flex-row flex-wrap gap-2">
        <Skeleton className="h-8 w-40 rounded-full" />
        <Skeleton className="h-8 w-24 rounded-full" delay={80} />
      </View>
      <Skeleton className="h-16 w-full rounded-xl" delay={160} />
      <Skeleton className="h-64 w-full rounded-xl" delay={240} />
    </View>
  );
}
