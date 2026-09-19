import { canEditBoardPost } from "@gongmoa/core";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import NotFoundScreen from "../../+not-found";
import { AppText } from "../../../src/components/app-text";
import { BoardForm } from "../../../src/components/board/board-form";
import { Button } from "../../../src/components/button";
import { LoginRequiredScreen, useRequireLogin } from "../../../src/components/mypage/require-login";
import { QueryState } from "../../../src/components/query-state";
import { Screen } from "../../../src/components/screen";
import { Skeleton } from "../../../src/components/skeleton";
import { useBoardPostForEdit, type BoardPostEditable } from "../../../src/queries/board-write";
import { useAuth } from "../../../src/providers/auth-provider";

// `/board/[id]/edit`(설계서 §5 행 — modal, 웹 app/board/[id]/edit/page.tsx 1:1). 로그인 필요(useRequireLogin
// 관례, 웹은 `error=로그인이 필요해요` 로 같은 문구). 수정 권한은 서버(EF board-write)가 최종적으로 다시
// 확인하지만, 화면부터 막아야 "고쳐 썼는데 저장이 안 되는" 헛수고가 없다 — 판정은 웹과 같은 core
// canEditBoardPost(본인만, 관리자에게도 열지 않는다).
//
// 모달 프레젠테이션은 루트 _layout.tsx 의 Stack 에 등록돼 있다(new.tsx 와 같다).

function isUuid(v: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
}

export default function EditBoardPostRoute() {
  const params = useLocalSearchParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const valid = !!id && isUuid(id);
  const { userId, loading } = useRequireLogin(`/board/${id ?? ""}/edit`);

  if (!valid) return <NotFoundScreen />;
  if (loading) return <Screen contentClassName="gap-5" />;
  if (!userId) return <LoginRequiredScreen />;
  return <EditScreen id={id} userId={userId} />;
}

function EditScreen({ id, userId }: { id: string; userId: string }) {
  const { isAdmin } = useAuth();
  const query = useBoardPostForEdit(id);
  // 없는 글 → 404(웹 notFound). Screen 안에 다시 Screen 을 두지 않는다.
  if (query.isSuccess && query.data === null) return <NotFoundScreen />;
  return (
    <Screen contentClassName="gap-5">
      <QueryState query={query} skeleton={<EditSkeleton />}>
        {(post) =>
          post ? (
            canEditBoardPost({ user_id: post.authorId }, { userId, isAdmin }) ? (
              <EditBody post={post} isAdmin={isAdmin} />
            ) : (
              <CannotEdit id={post.id} />
            )
          ) : null
        }
      </QueryState>
    </Screen>
  );
}

function EditBody({ post, isAdmin }: { post: BoardPostEditable; isAdmin: boolean }) {
  return (
    <>
      <View>
        <Pressable
          accessibilityRole="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace(`/board/${post.id}` as Href))}
          hitSlop={6}
          className="self-start"
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 글로 돌아가기
          </AppText>
        </Pressable>
        <AppText variant="2xl" weight="bold" className="mt-2">
          글 수정
        </AppText>
      </View>

      <BoardForm
        mode="edit"
        postId={post.id}
        isAdmin={isAdmin}
        initial={{
          title: post.title,
          category: post.category,
          contentHtml: post.contentHtml,
          isPinned: post.isPinned,
        }}
      />
    </>
  );
}

// 웹 edit/page.tsx 의 `!post.canEdit` 분기 1:1.
function CannotEdit({ id }: { id: string }) {
  return (
    <View className="w-full max-w-2xl items-center gap-4 self-center px-4 py-24">
      <AppText variant="lg" weight="bold" className="text-center">
        수정할 수 없는 글이에요
      </AppText>
      <AppText variant="sm" className="text-center text-zinc-500 dark:text-zinc-400" pretty>
        글은 작성한 본인만 수정할 수 있어요.
      </AppText>
      <Button
        label="글로 돌아가기"
        onPress={() => router.dismissTo(`/board/${id}` as Href)}
        className="rounded-lg px-4 py-2"
        textClassName="font-medium"
      />
    </View>
  );
}

function EditSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-5 w-24 rounded" />
      <Skeleton className="h-8 w-32 rounded" />
      <Skeleton className="h-9 w-full rounded-full" />
      <Skeleton className="h-11 w-full rounded-xl" />
      <Skeleton className="h-80 w-full rounded-xl" delay={80} />
    </View>
  );
}
