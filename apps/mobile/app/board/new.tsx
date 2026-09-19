import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { BOARD_NEW_LOGIN_MESSAGE } from "../../src/components/board/board-login";
import { BoardForm } from "../../src/components/board/board-form";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { Screen } from "../../src/components/screen";
import { useAuth } from "../../src/providers/auth-provider";

// `/board/new`(설계서 §5 행 — new·edit 는 modal, 웹 app/board/new/page.tsx 1:1): 목록·본문은 비회원도
// 보지만 글쓰기는 로그인이 필요하다(작성자를 특정할 수 있어야 수정·삭제 권한을 줄 수 있다). 게스트
// 처리는 useRequireLogin 관례(`/login?next=/board/new&error=…`)이고 error 문구는 웹 redirect 그대로
// "로그인 후 글을 쓸 수 있어요"(board-login.ts — 목록의 글쓰기 버튼도 같은 문장으로 보낸다).
//
// 모달 프레젠테이션은 루트 _layout.tsx 의 Stack 에 등록돼 있다(login·onboarding 과 같은 자리).
export default function NewBoardPostScreen() {
  const { userId, loading } = useRequireLogin("/board/new", BOARD_NEW_LOGIN_MESSAGE);
  const { isAdmin } = useAuth();

  return (
    <>
      {loading ? (
        <Screen contentClassName="gap-5" />
      ) : !userId ? (
        <LoginRequiredScreen message={BOARD_NEW_LOGIN_MESSAGE} />
      ) : (
        <Screen contentClassName="gap-5">
          <View>
            <Pressable
              accessibilityRole="link"
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/board" as Href))}
              hitSlop={6}
              className="self-start"
            >
              <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
                ← 자유게시판
              </AppText>
            </Pressable>
            <AppText variant="2xl" weight="bold" className="mt-2">
              글쓰기
            </AppText>
          </View>

          <BoardForm mode="create" isAdmin={isAdmin} />
        </Screen>
      )}
    </>
  );
}
