import { isEdgeError, KST_TIME_ZONE, subjectColor, type ReviewHistoryMixNote } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Shuffle } from "lucide-react-native";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../../../+not-found";
import { AppText } from "../../../../../src/components/app-text";
import { MembershipUpsell } from "../../../../../src/components/explanations/membership-upsell";
import { LoginRequiredScreen, useRequireLogin } from "../../../../../src/components/mypage/require-login";
import { QueryState } from "../../../../../src/components/query-state";
import { Screen } from "../../../../../src/components/screen";
import { Skeleton } from "../../../../../src/components/skeleton";
import { MixSessionView } from "../../../../../src/components/wrong-notes/mix-session-view";
import {
  useWrongNoteDeletions,
  type WrongNoteDeletions,
} from "../../../../../src/components/wrong-notes/wrong-note-mark-actions";
import { useAuth } from "../../../../../src/providers/auth-provider";
import { useMixSessionNote } from "../../../../../src/queries/wrong-notes";

// `/mypage/wrong-notes/[slug]/mix/[sessionId]`(설계서 §5 행, 웹 .../mix/[sessionId]/page.tsx 1:1) —
// 기출 섞어풀기 한 세션의 오답노트("9월 5일 섞어풀기"). 과목 오답노트의 문제지 카드와 같은
// 층위의 화면이다: 문제지 한 장 대신 그날 섞어 푼 문항 묶음이 단위일 뿐, 틀린 문항·정답·해설·
// 메모·다시 풀기가 같은 모양으로 붙는다.
//
// 데이터는 EF `review-history { sessionId, view: "mix-note" }` 하나(§6.7 #10) — review_sessions·
// review_session_items 는 RLS 정책이 없어 클라이언트가 직접 못 읽는다. 정답·해설 본문이 실리므로
// 메모리 전용 캐시다(queries/wrong-notes.ts useMixSessionNote).
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default function MixSessionNoteRoute() {
  const params = useLocalSearchParams<{ slug: string; sessionId: string }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? "";
  const { userId, loading } = useRequireLogin(`/mypage/wrong-notes/${slug}/mix/${sessionId}`);

  if (!slug || !isUuid(sessionId)) return <NotFoundScreen />;
  if (loading) return <Screen contentClassName="gap-6" />;
  if (!userId) return <LoginRequiredScreen />;
  return <MixSessionNoteScreen slug={slug} sessionId={sessionId} />;
}

function MixSessionNoteScreen({ slug, sessionId }: { slug: string; sessionId: string }) {
  const query = useMixSessionNote(sessionId);
  // 삭제 되돌리기 토스트는 뷰포트에 고정돼야 해서 Screen 의 overlay 슬롯으로 올린다
  // (src/components/screen.tsx ScreenOverlay 머리말) — 그 상태를 화면이 들고 본문에는 값으로
  // 내려 준다. 훅 순서를 지키려고 조기 반환보다 먼저 부른다.
  const deletions = useWrongNoteDeletions<string>();
  // 남의 세션·채점 전·섞어풀기가 아닌 세션은 EF 가 404 로 잘라 준다(웹 notFound).
  if (query.isError && isEdgeError(query.error) && query.error.status === 404) return <NotFoundScreen />;
  const mismatched = query.isSuccess && query.data.subject.slug !== slug;
  if (mismatched) return <NotFoundScreen />;

  return (
    <Screen
      contentClassName="gap-6"
      overlay={deletions.toast()}
      refreshing={query.isRefetching}
      onRefresh={() => void query.refetch()}
    >
      <QueryState query={query} skeleton={<MixSkeleton />}>
        {(note) => <MixSessionNoteBody slug={slug} note={note} deletions={deletions} />}
      </QueryState>
    </Screen>
  );
}

function MixSessionNoteBody({
  slug,
  note,
  deletions,
}: {
  slug: string;
  note: ReviewHistoryMixNote;
  deletions: WrongNoteDeletions<string>;
}) {
  const { isPremium } = useAuth();
  const { session, subject, questions, wrongCount, resolvedCount } = note;
  const pct = session.total > 0 ? Math.round((session.score / session.total) * 100) : 0;
  const when = new Date(session.createdAt).toLocaleString("ko-KR", {
    timeZone: KST_TIME_ZONE,
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const self = `/mypage/wrong-notes/${slug}/mix/${session.id}`;
  const color = subjectColor(subject.slug);

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
            ← {subject.name} 오답노트로
          </AppText>
        </Pressable>

        <View className="flex-row flex-wrap items-center gap-2">
          <View className={["rounded px-2 py-0.5", color].join(" ")}>
            <AppText variant="xs" weight="medium" allowFontScaling={false} className={color}>
              {subject.name}
            </AppText>
          </View>
          <View className="flex-row items-center gap-1 rounded bg-blue-100 px-2 py-0.5 dark:bg-blue-950/40">
            <Shuffle size={11} color="#1d4ed8" />
            <AppText variant="xs" weight="bold" allowFontScaling={false} className="text-blue-700 dark:text-blue-300">
              기출 섞어풀기
            </AppText>
          </View>
        </View>

        <AppText variant="2xl" weight="semibold" className="leading-snug" pretty>
          {session.title}
        </AppText>
        <AppText variant="xs" className="text-zinc-500 dark:text-zinc-500">
          {when} 풀이
        </AppText>
      </View>

      {/* 점수 요약 — 과목 오답노트 상단 요약 바와 같은 문법(빨강=남은 오답, 초록=극복). */}
      <View className="flex-row items-center gap-4 rounded-xl bg-zinc-50 px-4 py-3 dark:bg-zinc-800/40">
        <Stat label="점수" value={`${session.score}/${session.total}`} sub={`${pct}점`} color="text-zinc-700 dark:text-zinc-200" />
        <View className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Stat
          label="남은 오답"
          value={String(Math.max(0, wrongCount - resolvedCount))}
          sub="문항"
          color="text-red-600 dark:text-red-400"
        />
        <View className="h-8 w-px bg-zinc-200 dark:bg-zinc-700" />
        <Stat label="극복" value={String(resolvedCount)} sub="문항" color="text-emerald-600 dark:text-emerald-400" />
      </View>

      <MixSessionView
        subjectSlug={slug}
        questions={questions}
        wrongCount={wrongCount}
        resolvedCount={resolvedCount}
        lockNext={self}
        deletions={deletions}
      />

      {!isPremium && wrongCount > 0 && (
        <MembershipUpsell
          title="해설까지 보면서 복습하려면"
          description="멤버십은 문항별 해설을 볼 수 있고, 언제 다시 볼지 계산해주는 복습 일정까지 이어져요."
          next={self}
        />
      )}
    </>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <View>
      <AppText variant="11" weight="semibold" className="tracking-wide text-zinc-400 dark:text-zinc-500">
        {label}
      </AppText>
      <AppText variant="2xl" weight="extrabold" tabular className={["mt-0.5 leading-none", color].join(" ")}>
        {value}
        <AppText variant="sm" weight="medium" className="text-zinc-400 dark:text-zinc-500">
          {" "}
          {sub}
        </AppText>
      </AppText>
    </View>
  );
}

function MixSkeleton() {
  return (
    <View className="gap-6">
      <View className="gap-3">
        <Skeleton className="h-4 w-32 rounded" />
        <View className="flex-row gap-2">
          <Skeleton className="h-5 w-14 rounded" delay={60} />
          <Skeleton className="h-5 w-24 rounded" delay={120} />
        </View>
        <Skeleton className="h-8 w-56 rounded-lg" delay={180} />
      </View>
      <Skeleton className="h-16 w-full rounded-xl" delay={240} />
      <View className="gap-2">
        <Skeleton className="h-12 w-full rounded-xl" />
        <Skeleton className="h-12 w-full rounded-xl" delay={80} />
      </View>
      <Skeleton className="h-64 w-full rounded-xl" delay={160} />
    </View>
  );
}
