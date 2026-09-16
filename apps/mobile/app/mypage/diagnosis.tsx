import { DIAGNOSIS_LOCKED_HINT, DIAGNOSIS_WINDOW_DAYS, isEdgeError } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { CircleQuestionMark } from "lucide-react-native";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { Button } from "../../src/components/button";
import { DiagnosisBoard } from "../../src/components/diagnosis/diagnosis-board";
import { DiagnosisProgress } from "../../src/components/diagnosis/diagnosis-progress";
import { MembershipUpsell } from "../../src/components/explanations/membership-upsell";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { QueryState } from "../../src/components/query-state";
import { Screen } from "../../src/components/screen";
import { Skeleton } from "../../src/components/skeleton";
import { useSetScreenParams } from "../../src/lib/screen-params";
import { useAuth } from "../../src/providers/auth-provider";
import { useDiagnosisBoard, useDiagnosisReport } from "../../src/queries/diagnosis";
import { themedIcon } from "../../src/theme/icons";

// `/mypage/diagnosis?range&subject`(설계서 §5 행 · §8.3 · §12 Phase 4) — 웹
// app/mypage/diagnosis/{page,diagnosis-board,diagnosis-actions,loading}.tsx 1:1.
//
// 입장 즉시 보이는 것은 전부 결정적 데이터(무AI)다:
//   A) 최근 7일에 틀린 개념 막대그래프 — 이번 주에 뭘 틀렸는지 한눈에
//   B) 맞춤 극복법 — 개념을 골라 요청하면 그 개념들에 대해서만 AI 진단이 붙는다
//
// 기간(?range=)은 그래프에만 걸린다. 극복법이 훑는 기간은 칩과 무관하게 언제나 최근 7일
// (DIAGNOSIS_WINDOW_DAYS)이다 — 그래야 화면·프롬프트·안내가 같은 숫자를 말한다.
// 과목(?subject=)은 서버가 거르지 않는다. 전 과목 집계를 한 번 받아 화면이 즉시 거른다.
//
// **앱이 웹과 다른 곳은 둘뿐이고 둘 다 "서버가 하는 일이 달라서"다**:
//   1) 집계·요청은 EF(`diagnosis-aggregate`·`diagnosis-request`)로 간다. 규칙은 웹 서버
//      액션과 같은 core 함수 하나다(rules/diagnosis-{aggregate,request}.ts).
//   2) 리포트 본문은 `ai_diagnoses` 를 RLS 로 직접 읽고, 기다리는 동안에는 EF
//      `diagnosis-collect` 를 불러 **배치를 직접 수거한다**(다음 정시를 기다리지 않는다).
//      집계로 폴링하면 한 번에 60왕복이다(queries/diagnosis.ts 머리말).
const HelpIcon = themedIcon(CircleQuestionMark);

const BACK_HREF = "/mypage?tab=wrong-notes" as Href;
const SELF = "/mypage/diagnosis";

// 그래프 기간 칩. 기본은 분석 창과 같은 최근 7일이고, 30일·전체는 "쌓인 오답을 넓게 보기"용이다
// (극복법은 칩과 무관하게 늘 7일). 웹 page.tsx RANGES 와 같은 목록 — 칩을 늘리면 Edge 쪽 기간
// 검증(parseDays)이 아니라 이 목록이 정본이다.
const RANGES = [
  { key: "7", days: DIAGNOSIS_WINDOW_DAYS as number | null, label: `최근 ${DIAGNOSIS_WINDOW_DAYS}일` },
  { key: "30", days: 30 as number | null, label: "최근 30일" },
  { key: "all", days: null as number | null, label: "전체" },
];

export default function DiagnosisRoute() {
  const { userId, loading } = useRequireLogin(SELF);
  if (loading) return <Screen contentClassName="gap-6" />;
  if (!userId) return <LoginRequiredScreen />;
  return <DiagnosisScreen />;
}

function DiagnosisScreen() {
  // membership-get 이 아직 안 돌아왔을 때 isPremium 은 false 다 — 그대로 그리면 프리미엄
  // 회원이 화면을 열 때마다 잠금 화면이 한 번 번쩍인다. 멤버십을 아는 순간까지는 스켈레톤.
  const { isPremium, membershipLoading } = useAuth();
  const params = useLocalSearchParams<{ range?: string; subject?: string }>();
  const setScreenParams = useSetScreenParams();

  const range = RANGES.find((r) => r.key === params.range) ?? RANGES[0];
  // 과목 필터는 화면이 들고 URL(?subject=)에도 실어 둔다. 보드가 아니라 여기인 이유: 기간 칩을
  // 누르면 집계 쿼리 키가 갈려 보드 자리가 잠깐 스켈레톤이 되는데, 상태가 보드 안에 있으면 그때
  // 과목 선택이 풀려 다시 찾아 눌러야 한다(웹은 기간 링크에 ?subject 를 실어 같은 것을 지킨다).
  const [subject, setSubject] = useState<string | null>(
    typeof params.subject === "string" && params.subject ? params.subject : null,
  );

  // 집계는 멤버십 기능이다. 서버도 403 으로 막지만(§8.3), 못 볼 화면을 위해 계정 전체 오답을
  // 훑는 60왕복을 보내지 않으려고 호출 자체를 하지 않는다 — 웹 page.tsx 가 집계 전에 판정하는
  // 것과 같은 순서다.
  const premiumReady = isPremium && !membershipLoading;
  const boardQuery = useDiagnosisBoard(range.key, range.days, premiumReady);
  const report = useDiagnosisReport(premiumReady);

  if (membershipLoading) {
    return (
      <Screen contentClassName="gap-6">
        <DiagnosisHeader />
        <BoardSkeleton />
      </Screen>
    );
  }

  // 무료 회원: 웹 MembershipLockedPage 와 같은 자리(404 로 돌려보내지 않는다 — 주소는 유효하고
  // 데이터도 남아 있다, 지금 못 볼 뿐이다). 문구는 웹 page.tsx 그대로.
  //
  // 서버가 403 을 준 경우도 같은 자리다(§6.9 2번 "403 → MembershipLocked"): 화면을 보는 동안
  // 멤버십이 끝나면 여기로 온다. 그걸 붉은 오류 띠로 그리면 "고장"으로 읽힌다.
  if (!isPremium || (isEdgeError(boardQuery.error) && boardQuery.error.status === 403)) {
    return (
      <Screen contentClassName="gap-6">
        <BackLink />
        <MembershipUpsell
          title="AI 약점 진단은 멤버십 기능이에요"
          description="과목별로 어떤 개념에서 주로 틀리는지 그래프로 보여주고, 고른 개념마다 왜 틀렸는지 분석해 맞춤 극복법과 같은 개념 기출 문제를 이어줘요. 지금까지 쌓인 오답은 그대로 남아 있어요."
          next={SELF}
        />
      </Screen>
    );
  }

  return (
    <Screen
      contentClassName="gap-6"
      refreshing={boardQuery.isRefetching || report.query.isRefetching}
      onRefresh={() => {
        void boardQuery.refetch();
        // 리포트 재조회 + (기다리는 중이면) 수거 한 번. 폴링 상한(화면에 머문 10분)에 걸린
        // 뒤에는 이것이 결과를 당겨 오는 유일한 길이다.
        report.refresh();
      }}
    >
      <DiagnosisHeader />
      <QueryState query={boardQuery} skeleton={<BoardSkeleton />}>
        {(board) =>
          board.concepts.length === 0 ? (
            <EmptyState eligibility={board.eligibility} />
          ) : (
            <DiagnosisBoard
              board={board}
              ranges={RANGES.map((r) => ({ key: r.key, label: r.label }))}
              rangeKey={range.key}
              onChangeRange={(key) => setScreenParams({ range: key === RANGES[0].key ? undefined : key })}
              // 딥링크·복귀로 들어온 `?subject=` 가 이 계정에 없는 과목일 수 있다(다른 계정의
              // 링크, 예전에만 풀던 과목). 웹 page.tsx 도 `graph.subjects` 에 있는 값만 초기
              // 선택으로 인정한다 — 안 그러면 막대가 하나도 없는 그래프가 뜨고, 응시 과목이
              // 하나뿐인 계정은 과목 탭 줄 자체가 안 그려져(`subjects.length > 1`) 해제할
              // 방법조차 없다.
              subject={board.subjects.some((s) => s.slug === subject) ? subject : null}
              onChangeSubject={(slug) => {
                setSubject(slug);
                setScreenParams({ subject: slug ?? undefined });
              }}
              coaching={report.query.data?.coaching ?? []}
              coachingDate={report.query.data?.coachingDate ?? null}
              cycle={report.query.data?.cycle ?? null}
              cycleLoaded={report.query.isSuccess}
              generating={board.generating}
              batch={report.batch}
              polling={report.polling}
              failure={report.failure}
              awaitingSubmit={report.awaitingSubmit}
            />
          )
        }
      </QueryState>
    </Screen>
  );
}

function DiagnosisHeader() {
  return (
    <View className="gap-1.5">
      <BackLink />
      <View className="flex-row flex-wrap items-center justify-between gap-2">
        <AppText variant="2xl" weight="bold" accessibilityRole="header">
          AI 약점 진단
        </AppText>
        {/* 규칙(주기·분석 기간·상한·자격)은 전용 안내 화면이 맡는다. 대시보드에 다 적으면 정작
            볼 것이 밀린다. */}
        <Pressable
          accessibilityRole="link"
          onPress={() => router.push("/diagnosis" as Href)}
          hitSlop={6}
          className="flex-row items-center gap-1 rounded-full border border-zinc-200 bg-white px-2.5 py-1 active:bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900 dark:active:bg-zinc-800"
        >
          <HelpIcon size={13} colorClassName="text-zinc-500 dark:text-zinc-400" />
          <AppText variant="xs" weight="semibold" className="text-zinc-500 dark:text-zinc-400">
            진단 안내
          </AppText>
        </Pressable>
      </View>
    </View>
  );
}

function BackLink() {
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => router.navigate(BACK_HREF)}
      hitSlop={6}
      className="self-start"
    >
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
        ← 오답노트로
      </AppText>
    </Pressable>
  );
}

// 분석할 오답 개념이 하나도 없을 때(웹 page.tsx EmptyState 1:1). 자격 미달이면 "얼마나
// 남았는지"를 숫자로 — 가장 빨리 채우는 길은 CBT 한 회차라 바를 누르면 문제지 목록으로 간다.
// 자격 계산은 core computeDiagnosisProgress 가 한다(DiagnosisProgress 안) — 앱이 문턱을 다시
// 세지 않는다.
function EmptyState({
  eligibility,
}: {
  eligibility: { eligible: boolean; attemptCount: number; wrongCount: number };
}) {
  return (
    <View className="items-center gap-3 rounded-2xl border border-zinc-100 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900">
      <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400" pretty>
        {eligibility.eligible
          ? "아직 분석할 오답 개념이 없어요. 문제를 조금 더 풀면 여기에 약점이 정리돼요."
          : DIAGNOSIS_LOCKED_HINT}
      </AppText>
      {!eligibility.eligible && (
        <View className="w-full max-w-sm">
          <DiagnosisProgress
            attemptCount={eligibility.attemptCount}
            wrongCount={eligibility.wrongCount}
            lockedHref="/papers"
          />
        </View>
      )}
      <Button
        label={eligibility.eligible ? "오답노트로 가기" : "문제 풀러 가기"}
        accessibilityRole="link"
        onPress={() => router.navigate((eligibility.eligible ? BACK_HREF : "/papers") as Href)}
        className="px-4"
      />
    </View>
  );
}

// 웹 loading.tsx: 제목 → 그래프 카드 → 극복법 카드 3장 자리.
function BoardSkeleton() {
  return (
    <View className="gap-6">
      <Skeleton className="h-40 w-full rounded-2xl" />
      <View className="gap-3">
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            className="gap-3 rounded-2xl border border-zinc-100 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900"
          >
            <View className="flex-row gap-2">
              <Skeleton className="h-6 w-24 rounded-full" delay={i * 60} />
              <Skeleton className="h-6 w-20 rounded-full" delay={i * 60 + 60} />
            </View>
            <Skeleton className="h-5 w-40 rounded" delay={i * 60 + 120} />
            <View className="flex-row gap-2">
              <Skeleton className="h-9 flex-1 rounded-lg" delay={i * 60 + 180} />
              <Skeleton className="h-9 flex-1 rounded-lg" delay={i * 60 + 240} />
            </View>
          </View>
        ))}
      </View>
    </View>
  );
}
