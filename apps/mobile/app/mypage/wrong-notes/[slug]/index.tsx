import { subjectColor, type Subject, type WrongNotePaperGroup } from "@gongmoa/core";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { Shuffle } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../../+not-found";
import { AppText } from "../../../../src/components/app-text";
import { InlineAlert } from "../../../../src/components/feedback";
import { LoginRequiredScreen, useRequireLogin } from "../../../../src/components/mypage/require-login";
import { SubjectPaperList } from "../../../../src/components/papers/subject-paper-list";
import { QueryState } from "../../../../src/components/query-state";
import { Screen } from "../../../../src/components/screen";
import { Skeleton } from "../../../../src/components/skeleton";
import { SubjectWrongNoteQuestions } from "../../../../src/components/wrong-notes/subject-wrong-note-questions";
import { WrongNoteViewTabs, type WrongNoteViewKey } from "../../../../src/components/wrong-notes/wrong-note-view-tabs";
import { useSetScreenParams } from "../../../../src/lib/screen-params";
import { useAuth } from "../../../../src/providers/auth-provider";
import { useSubjectBySlug } from "../../../../src/queries/catalog";
import { useSubjectWrongNotePapers, useSubjectWrongNoteQuestions } from "../../../../src/queries/wrong-notes";

// `/mypage/wrong-notes/[slug]?view=`(설계서 §5 행, 웹 app/mypage/wrong-notes/[slug]/page.tsx 1:1) —
// 마이페이지 오답노트 탭에서 과목을 골랐을 때 나오는 화면. 기본 "시험지별"은 문제지 요약 카드
// 목록(누르면 회독별 기록·해설), "문제만 모아보기"는 그 과목에서 틀린 문항을 문제지 경계 없이
// 한 목록으로 펼친다. 웹은 ?view 로 서버에서 갈라 렌더하고 앱은 뷰마다 쿼리를 따로 두지만,
// 주소(?view=questions)는 같게 유지해 딥링크·뒤로가기가 같은 뜻이 된다.
//
// 오답노트는 무료다 — 열람도, 메모·다시 볼 문제 정리도, 섞어풀기도. 멤버십은 해설 본문과 회독
// 평균 비교에만 쓴다(§8.3).
//
// **섞어풀기 기록(MixSessionList) 섹션은 아직 없다**: 카드가 그리는 극복 진행률(wrongCount·
// resolvedCount)이 EF review-history 목록 응답에 없어 세션마다 mix-note 상세를 받아야 한다 —
// 설계서 §12 Phase 3 "믹스 기록". 기록 자체는 복습 결과 화면의 배너와 `…/mix/[sessionId]` 로
// 열린다.
type Params = { slug: string; view?: string };

export default function SubjectWrongNoteRoute() {
  const params = useLocalSearchParams<Params>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const view: WrongNoteViewKey = params.view === "questions" ? "questions" : "papers";
  const { userId, loading } = useRequireLogin(
    slug === "all" ? "/mypage?tab=wrong-notes" : `/mypage/wrong-notes/${slug}`,
  );

  // slug "all" 은 전 과목 세션(`…/all/review/[id]`) 전용이라 과목 화면이 없다 — 허브로 보낸다.
  if (slug === "all") return <Redirect href={"/mypage?tab=wrong-notes" as Href} />;
  if (loading) return <Screen contentClassName="gap-5" />;
  if (!userId) return <LoginRequiredScreen />;
  return <SubjectWrongNoteScreen slug={slug} view={view} />;
}

function SubjectWrongNoteScreen({ slug, view }: { slug: string; view: WrongNoteViewKey }) {
  const { query: catalog, subject } = useSubjectBySlug(slug);
  const setScreenParams = useSetScreenParams();

  if (subject === undefined) {
    return (
      <Screen contentClassName="gap-5">
        {catalog.isError ? (
          <InlineAlert
            message={catalog.error instanceof Error ? catalog.error.message : "과목을 불러오지 못했어요."}
            onRetry={() => void catalog.refetch()}
          />
        ) : (
          <>
            <ShellSkeleton />
            <ListSkeleton />
          </>
        )}
      </Screen>
    );
  }
  // 없는 과목 slug → 404(웹 notFound).
  if (subject === null) return <NotFoundScreen />;

  return (
    <SubjectWrongNoteBody
      subject={subject}
      view={view}
      onChangeView={(next) => setScreenParams({ view: next === "questions" ? "questions" : undefined })}
    />
  );
}

function SubjectWrongNoteBody({
  subject,
  view,
  onChangeView,
}: {
  subject: Subject;
  view: WrongNoteViewKey;
  onChangeView: (view: WrongNoteViewKey) => void;
}) {
  const { isPremium } = useAuth();
  const papers = useSubjectWrongNotePapers(view === "papers" ? subject : null);
  const questions = useSubjectWrongNoteQuestions(view === "questions" ? subject : null);
  const active = view === "questions" ? questions : papers;

  const summary = useMemo(() => {
    if (view === "questions") {
      const note = questions.data;
      if (!note || note.unresolvedCount + note.resolvedCount === 0) return null;
      return { unresolved: note.unresolvedCount, resolved: note.resolvedCount, paperCount: undefined };
    }
    const list = papers.data;
    if (!list) return null;
    const unresolved = list.reduce((sum, p) => sum + p.unresolvedCount, 0);
    const resolved = list.reduce((sum, p) => sum + p.resolvedCount, 0);
    if (unresolved + resolved === 0) return null;
    return { unresolved, resolved, paperCount: list.length };
  }, [view, papers.data, questions.data]);

  const color = subjectColor(subject.slug);

  return (
    <Screen contentClassName="gap-5" refreshing={active.isRefetching} onRefresh={() => void active.refetch()}>
      <View className="gap-3">
        <Pressable
          accessibilityRole="link"
          onPress={() => router.navigate("/mypage?tab=wrong-notes" as Href)}
          hitSlop={6}
          className="self-start"
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 오답노트로
          </AppText>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2">
          <View className={["rounded px-2 py-0.5", color].join(" ")}>
            <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
              {subject.name}
            </AppText>
          </View>
        </View>

        <View className="flex-row flex-wrap items-center justify-between gap-3">
          <AppText variant="2xl" weight="semibold" className="min-w-0 flex-1">
            {subject.name} 오답노트
          </AppText>
          {/* 이 과목 기출 전체에서 새 문제를 뽑는 기능이라 오답 유무와 무관하게 언제나 보인다. */}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="기출 섞어풀기"
            onPress={() => router.push(`/subjects/${subject.slug}/mix` as Href)}
            className="shrink-0 flex-row items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 active:bg-blue-100 dark:border-blue-800 dark:bg-blue-950/40"
          >
            <Shuffle size={12} color="#1d4ed8" />
            <AppText variant="xs" weight="medium" className="text-blue-700 dark:text-blue-400">
              기출 섞어풀기
            </AppText>
          </Pressable>
        </View>
      </View>

      {active.isPending ? <ShellSkeleton /> : summary && <WrongNoteSummary {...summary} />}

      <View className="gap-4">
        <WrongNoteViewTabs view={view} onChange={onChangeView} />

        {view === "questions" ? (
          <QueryState query={questions} skeleton={<ListSkeleton />}>
            {(note) => (
              <SubjectWrongNoteQuestions
                // 탭·과목이 바뀌면 필터·선택 상태를 새로 시작한다(웹은 페이지 이동이라 자연히 초기화).
                key={subject.slug}
                questions={note.questions}
                unresolvedCount={note.unresolvedCount}
                subjectSlug={subject.slug}
              />
            )}
          </QueryState>
        ) : (
          <QueryState query={papers} skeleton={<ListSkeleton />}>
            {(list) => <PapersView subjectSlug={subject.slug} papers={list} premium={isPremium} />}
          </QueryState>
        )}
      </View>
    </Screen>
  );
}

function PapersView({
  subjectSlug,
  papers,
  premium,
}: {
  subjectSlug: string;
  papers: WrongNotePaperGroup[];
  premium: boolean;
}) {
  const totalWrong = papers.reduce((sum, p) => sum + p.unresolvedCount + p.resolvedCount, 0);

  if (papers.length === 0) {
    return (
      <AppText variant="sm" className="py-16 text-center text-zinc-500 dark:text-zinc-500" pretty>
        이 과목에서는 아직 틀린 문제가 없어요. CBT로 문제를 풀거나 위의 기출 섞어풀기를 하면 틀린 문제가 자동으로 이곳에
        모여요.
      </AppText>
    );
  }

  return (
    <View className="gap-3">
      {totalWrong > 0 && (
        <AppText variant="xs" className="text-zinc-400 dark:text-zinc-500" pretty>
          {premium
            ? "시험지를 눌러 회독 기록·해설을 보거나, 아래 버튼으로 바로 다시 풀 수 있어요."
            : "시험지를 눌러 회독 기록·틀린 문항을 보거나, 아래 버튼으로 바로 다시 풀 수 있어요."}
        </AppText>
      )}
      <SubjectPaperList
        subjectSlug={subjectSlug}
        papers={papers.map((p) => ({
          paperId: p.paper.id,
          title: p.paper.title,
          level: p.paper.level,
          attemptCount: p.attemptCount,
          latestScore: p.latestScore,
          latestTotal: p.latestTotal,
          lastAttemptAt: p.lastAttemptAt,
          unresolved: p.unresolvedCount,
          resolved: p.resolvedCount,
        }))}
      />
    </View>
  );
}

// 과목 전체 진행 요약 바(웹 WrongNoteSummary). 남은 오답(빨강) → 극복(초록) → 시험지 수 순.
// 시험지 수는 "시험지별" 뷰에서만 의미가 있어 옵션.
function WrongNoteSummary({
  unresolved,
  resolved,
  paperCount,
}: {
  unresolved: number;
  resolved: number;
  paperCount?: number;
}) {
  return (
    <View className="flex-row items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
      <SummaryStat label="남은 오답" value={unresolved} unit="문항" color="text-red-600 dark:text-red-400" />
      <View className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
      <SummaryStat label="극복" value={resolved} unit="문항" color="text-emerald-600 dark:text-emerald-400" />
      {paperCount != null && (
        <>
          <View className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
          <SummaryStat label="시험지" value={paperCount} unit="장" color="text-zinc-700 dark:text-zinc-200" />
        </>
      )}
    </View>
  );
}

function SummaryStat({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <View>
      <AppText variant="11" weight="semibold" className="tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </AppText>
      <AppText variant="2xl" weight="extrabold" tabular className={["mt-0.5 leading-none", color].join(" ")}>
        {value}
        <AppText variant="sm" weight="medium" className="text-zinc-400 dark:text-zinc-500">
          {" "}
          {unit}
        </AppText>
      </AppText>
    </View>
  );
}

// 기다리는 동안 자리를 잡아두는 뼈대(웹 SummarySkeleton·ListSkeleton).
function ShellSkeleton() {
  return (
    <View className="flex-row items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
      <Skeleton className="h-10 w-20 rounded-lg" />
      <View className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
      <Skeleton className="h-10 w-20 rounded-lg" delay={80} />
    </View>
  );
}

function ListSkeleton() {
  return (
    <View className="gap-3">
      {[0, 1, 2].map((i) => (
        <View key={i} className="gap-2 rounded-xl border border-zinc-200 p-4 dark:border-zinc-700">
          <View className="flex-row items-center gap-2">
            <Skeleton className="h-5 w-10 rounded" delay={i * 60} />
            <Skeleton className="h-5 flex-1 rounded-lg" delay={i * 60 + 30} />
          </View>
          <View className="flex-row items-center gap-3">
            <Skeleton className="h-4 w-14 rounded-full" delay={i * 60 + 60} />
            <Skeleton className="h-4 w-24 rounded-lg" delay={i * 60 + 90} />
            <Skeleton className="h-4 w-28 rounded-lg" delay={i * 60 + 120} />
          </View>
        </View>
      ))}
    </View>
  );
}
