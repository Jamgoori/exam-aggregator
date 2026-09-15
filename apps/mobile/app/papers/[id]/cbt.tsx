import { getPaperDisplayTitle } from "@gongmoa/core";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { Button } from "../../../src/components/button";
import { CbtSolver } from "../../../src/components/cbt/cbt-solver";
import { loginHref } from "../../../src/components/login-link";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { paperHref } from "../../../src/lib/paper-href";
import { currentCbtViewMode } from "../../../src/lib/profile";
import { useAuth } from "../../../src/providers/auth-provider";
import { useCbtPaper } from "../../../src/queries/cbt";

// `/papers/[id]/cbt`(웹 cbt/page.tsx 1:1, 설계서 §5 행). 몰입 화면 — 헤더·푸터·FAB·광고 없음,
// iOS 스와이프·Android 예측 뒤로가기는 Screen immersive 가 끈다. 비로그인은 웹처럼
// /login?next=/papers/<param>/cbt 로. has_cbt_answers false 이거나 question_count null 이면 솔버 대신
// 비몰입 안내 화면(일반 셸·헤더 있음, 문구 그대로) — 딥링크 진입에 필요.
export default function CbtRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const param = typeof id === "string" ? id : "";
  const { user, userId, loading } = useAuth();
  const query = useCbtPaper(param);

  if (loading) {
    return (
      <Screen immersive>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }
  if (!user) {
    return <Redirect href={loginHref(`/papers/${param}/cbt`) as Href} />;
  }

  // 조회 실패는 몰입 셸 안에서 InlineAlert + 재시도(QueryState 가 그린다).
  if (query.isError) {
    return (
      <Screen immersive>
        <View className="flex-1 justify-center px-4">
          <QueryState query={query} skeleton={null}>
            {() => null}
          </QueryState>
        </View>
      </Screen>
    );
  }

  return (
    <QueryState
      query={query}
      skeleton={
        <Screen immersive>
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator />
          </View>
        </Screen>
      }
    >
      {(data) => {
        if (!data) return <NotFoundScreen />;
        const { paper } = data;
        const href = paperHref(paper);

        if (!data.hasCbtAnswers || !paper.question_count) {
          return (
            <Screen>
              <View className="w-full max-w-lg items-center gap-4 self-center px-4 py-24">
                <AppText variant="xl" weight="semibold" className="text-center">
                  아직 CBT를 지원하지 않는 문제지예요
                </AppText>
                <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-500" pretty>
                  정답이 등록되면 CBT로 풀 수 있어요. 우선 원본 PDF로 풀어보세요.
                </AppText>
                <Button
                  label="문제지로 돌아가기"
                  className="px-5"
                  textClassName="font-medium"
                  onPress={() => router.replace(href as Href)}
                />
              </View>
            </Screen>
          );
        }

        return (
          <Screen immersive>
            <CbtSolver
              paperId={paper.id}
              paperHref={href}
              paperTitle={getPaperDisplayTitle(paper.title, paper.track)}
              fileUrl={data.fileUrl}
              totalQuestions={paper.question_count}
              choiceCount={paper.choice_count}
              questionImages={data.questionImages}
              questionChoiceCounts={data.questionChoiceCounts}
              defaultViewMode={currentCbtViewMode(user.user_metadata)}
              userId={userId}
            />
          </Screen>
        );
      }}
    </QueryState>
  );
}
