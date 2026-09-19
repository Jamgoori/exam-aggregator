import { router, type Href } from "expo-router";
import { Pressable, View } from "react-native";
import { AppText } from "../../src/components/app-text";
import { LoginRequiredScreen, useRequireLogin } from "../../src/components/mypage/require-login";
import { Screen } from "../../src/components/screen";
import { SuggestionForm } from "../../src/components/suggestions/suggestion-form";
import { useAuth } from "../../src/providers/auth-provider";

// `/suggestions/new`(설계서 §5 행 — new·edit 는 modal, 웹 app/suggestions/new/page.tsx 1:1): 글쓰기는 로그인
// 회원만 — 비밀글의 "본인"을 특정할 수 있어야 한다(웹 주석). 게스트 처리는 useRequireLogin 관례
// (`/login?next=/suggestions/new&error=…`) — 웹 redirect 에는 error 문구가 없어 앱 관례 문장("로그인이
// 필요해요")을 쓴다(목록의 "건의하기" 버튼도 같은 문장으로 보낸다).
//
// 모달 프레젠테이션은 루트 _layout.tsx 의 Stack 에 등록돼 있다(board/new 와 같은 자리).
export default function NewSuggestionScreen() {
  const { userId, loading } = useRequireLogin("/suggestions/new");
  const { isAdmin } = useAuth();

  if (loading) return <Screen contentClassName="gap-5" />;
  if (!userId) return <LoginRequiredScreen />;
  return (
    <Screen contentClassName="gap-5">
      <View>
        <Pressable
          accessibilityRole="link"
          onPress={() => (router.canGoBack() ? router.back() : router.replace("/suggestions" as Href))}
          hitSlop={6}
          className="self-start"
        >
          <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
            ← 건의게시판
          </AppText>
        </Pressable>
        <AppText variant="2xl" weight="bold" className="mt-2" accessibilityRole="header">
          건의하기
        </AppText>
      </View>

      <SuggestionForm isAdmin={isAdmin} />
    </Screen>
  );
}
