import { Redirect, router, useLocalSearchParams, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { InlineAlert } from "../../../src/components/feedback";
import { LoginRequiredScreen, useRequireLogin } from "../../../src/components/mypage/require-login";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { SuggestionForm } from "../../../src/components/suggestions/suggestion-form";
import { useSuggestion } from "../../../src/queries/suggestions";
import { useAuth } from "../../../src/providers/auth-provider";

// `/suggestions/[id]/edit`(설계서 §5 행 — modal, 웹 app/suggestions/[id]/edit/page.tsx 1:1). 로그인 필요
// (useRequireLogin 관례). 웹의 세 갈래 그대로: 없는 글 → 404, 볼 수 없는 글(남의 비밀글) → 수정 화면도 없다
// (로그인했으면 상세로), canEdit 아니면 → 상세로. 수정 권한은 서버(EF suggestions update)가 다시 검사한다 —
// 여기 검사는 화면을 안 보여주기 위한 것(웹 주석).
//
// 상세 쿼리(useSuggestion)를 그대로 쓴다 — 웹도 fetchSuggestion 한 벌로 수정 초기값을 채운다. 다만 그 조회는
// 조회수를 세는 get 이라(본인 글은 안 센다 — 수정 화면에 오는 것은 본인뿐이므로 실제로 늘지 않는다) 캐시가
// 살아 있으면 다시 부르지 않는다.
//
// 모달 프레젠테이션은 루트 _layout.tsx 의 Stack 에 등록돼 있다(new.tsx 와 같다).
export default function EditSuggestionRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const { userId, loading } = useRequireLogin(`/suggestions/${id ?? ""}/edit`);

  if (!id) return <NotFoundScreen />;
  if (loading) return <Screen contentClassName="gap-5" />;
  if (!userId) return <LoginRequiredScreen />;
  return <EditScreen id={id} />;
}

function EditScreen({ id }: { id: string }) {
  const { isAdmin } = useAuth();
  const result = useSuggestion(id);

  if (result.isSuccess) {
    if (result.data.status === "not_found") return <NotFoundScreen />;
    // 웹 redirect(`/suggestions/${id}`) 두 갈래(forbidden · !canEdit).
    if (result.data.status === "forbidden" || !result.data.suggestion.canEdit) {
      return <Redirect href={`/suggestions/${id}` as Href} />;
    }
  }

  return (
    <Screen contentClassName="gap-5">
      {result.isPending ? (
        <EditSkeleton />
      ) : result.isError ? (
        <InlineAlert
          message={result.error instanceof Error ? result.error.message : "글을 불러오지 못했어요."}
          onRetry={() => void result.refetch()}
        />
      ) : result.data.status === "ok" ? (
        <>
          <View>
            <Pressable
              accessibilityRole="link"
              onPress={() => (router.canGoBack() ? router.back() : router.replace(`/suggestions/${id}` as Href))}
              hitSlop={6}
              className="self-start"
            >
              <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
                ← 돌아가기
              </AppText>
            </Pressable>
            <AppText variant="2xl" weight="bold" className="mt-2" accessibilityRole="header">
              건의 수정
            </AppText>
          </View>

          <SuggestionForm
            suggestion={{
              id: result.data.suggestion.id,
              title: result.data.suggestion.title,
              content: result.data.suggestion.content,
              isSecret: result.data.suggestion.isSecret,
              isPinned: result.data.suggestion.isPinned,
            }}
            isAdmin={isAdmin}
          />
        </>
      ) : null}
    </Screen>
  );
}

function EditSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-5 w-20 rounded" />
      <Skeleton className="h-8 w-28 rounded" />
      <Skeleton className="h-10 w-full rounded-lg" />
      <Skeleton className="h-56 w-full rounded-lg" delay={80} />
      <Skeleton className="h-16 w-full rounded-xl" delay={160} />
    </View>
  );
}
