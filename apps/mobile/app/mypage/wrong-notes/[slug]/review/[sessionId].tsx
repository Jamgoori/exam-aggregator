import { isEdgeError } from "@gongmoa/core";
import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import NotFoundScreen from "../../../../+not-found";
import { Button } from "../../../../../src/components/button";
import { EmptyState } from "../../../../../src/components/feedback";
import { loginRedirectHref } from "../../../../../src/components/mypage/require-login";
import { QueryState } from "../../../../../src/components/query-state";
import { ReviewResult } from "../../../../../src/components/review/review-result";
import { ReviewSolver } from "../../../../../src/components/review/review-solver";
import { Screen } from "../../../../../src/components/screen";
import { useAuth } from "../../../../../src/providers/auth-provider";
import { useReviewSession } from "../../../../../src/queries/review";

// `/mypage/wrong-notes/[slug]/review/[sessionId]`(웹 .../review/[sessionId]/page.tsx 1:1,
// 설계서 §5 행). **몰입 화면** — 헤더·탭·푸터·FAB·광고 없음(복습 솔버에 광고 금지, AGENTS.md),
// iOS 가장자리 스와이프·Android 예측 뒤로가기는 Screen immersive 가 끄고 이탈 확인은 솔버가
// 자체 버튼 + BackHandler + Alert 로 한다.
//
// 세션은 오답노트의 "섞어풀기"·"틀린 문제 다시 풀기"(review-create)가 먼저 만들고 이 주소로
// 넘어온다. 본인 세션이 아니거나 없으면 404(EF 가 남의 세션에 아무것도 내주지 않는다).
//
// 멤버십을 보지 않는다 — 섞어풀기는 무료고, "오늘의 복습"으로 만들어진 세션도 여기서 막으면
// 체험이 끝난 사람이 풀던 답안이 통째로 날아간다(웹과 같은 판단). 이 화면은 해설을 보여주지
// 않으므로 해설 페이월과도 무관하다.
function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

// slug "all" = 전 과목 섞어풀기/복습(특정 과목 페이지가 없음) → 허브로. 기출 섞어풀기(scope
// 'mix')는 기록 카드가 붙는 "문제지별" 탭으로 돌아간다(웹 page.tsx 의 backHref 규칙).
function backHrefFor(slug: string, scope: string): string {
  if (slug === "all") return "/mypage?tab=wrong-notes";
  return scope === "mix" ? `/mypage/wrong-notes/${slug}` : `/mypage/wrong-notes/${slug}?view=questions`;
}

function ImmersiveSpinner() {
  return (
    <Screen immersive>
      <View className="flex-1 items-center justify-center">
        <ActivityIndicator />
      </View>
    </Screen>
  );
}

export default function ReviewSessionRoute() {
  const params = useLocalSearchParams<{ slug: string; sessionId: string }>();
  const slug = (Array.isArray(params.slug) ? params.slug[0] : params.slug) ?? "";
  const sessionId = (Array.isArray(params.sessionId) ? params.sessionId[0] : params.sessionId) ?? "";
  const valid = slug.length > 0 && isUuid(sessionId);
  const { userId, loading } = useAuth();
  const query = useReviewSession(valid ? sessionId : "", userId);

  // 세션 id 가 UUID 가 아니면 EF 도 400 을 준다 — 부르지 않고 웹 notFound() 자리로.
  if (!valid) return <NotFoundScreen />;
  if (loading) return <ImmersiveSpinner />;
  // 비로그인은 웹처럼 `/login?next=…&error=로그인이 필요해요`(웹은 오답노트 주소를 next 로 준다).
  if (!userId) {
    return <Redirect href={loginRedirectHref(slug === "all" ? "/mypage?tab=wrong-notes" : `/mypage/wrong-notes/${slug}`)} />;
  }
  // 없거나 남의 세션 → 404(웹 notFound).
  if (query.isError && isEdgeError(query.error) && query.error.status === 404) return <NotFoundScreen />;
  // 그 밖의 조회 실패는 몰입 셸 안에서 InlineAlert + 재시도(QueryState 가 그린다, §6.9).
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
    <Screen immersive>
      <View className="flex-1 justify-center">
        <QueryState
          query={query}
          skeleton={
            <View className="flex-1 items-center justify-center">
              <ActivityIndicator />
            </View>
          }
          isEmpty={(view) => view.items.length === 0}
          empty={
            <View className="px-4">
              <EmptyState
                title="이 세션에는 문항이 없어요"
                action={
                  <Button
                    label="오답노트로 돌아가기"
                    className="px-5"
                    onPress={() => router.replace(backHrefFor(slug, "") as Href)}
                  />
                }
              />
            </View>
          }
        >
          {(view) =>
            view.submitted ? (
              <ReviewResult view={view} backHref={backHrefFor(slug, view.scope)} subjectSlug={slug} />
            ) : (
              <ReviewSolver
                view={view}
                backHref={backHrefFor(slug, view.scope)}
                subjectSlug={slug}
                userId={userId}
              />
            )
          }
        </QueryState>
      </View>
    </Screen>
  );
}
