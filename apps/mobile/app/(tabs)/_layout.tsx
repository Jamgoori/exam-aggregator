import { Tabs } from "expo-router";
import { BookOpenCheck, FileStack, House, UserRound } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { palette, tokens, useIsDark } from "../../src/theme";

// 하단 탭 4개(소유자 결정 §12-2 1번): 홈 `/` · 기출문제 `/papers` · 오답노트
// `/mypage?tab=wrong-notes` · 마이페이지 `/mypage`. 드로어에는 웹 PRIMARY_NAV/ACCOUNT_NAV 전체가
// 그대로 있고 탭 항목도 빠지지 않는다(웹과 같은 입구). native-tabs 는 SDK 58 안정화 후.
//
// 오답노트 탭은 별도 화면이 아니라 마이페이지의 ?tab=wrong-notes 다. expo-router Tabs.Screen 의
// `href` 옵션(TabsClient.js "Support the `href` shortcut prop")이 탭 버튼을 그 주소로 가는 Link 로
// 바꿔 준다 — 눌렀을 때 활성 표시는 마이페이지 탭에 붙는다. wrong-notes.tsx 라우트 파일은 탭
// 이름 매칭용이고 직접 열리면 같은 주소로 Redirect 한다.
//
// 몰입 화면(CBT·복습·PDF)은 이 그룹 밖 루트 Stack 에 두어 탭바가 자연히 빠진다(Screen immersive).
export default function TabsLayout() {
  const dark = useIsDark();
  const t = dark ? tokens.dark : tokens.light;
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.blue[600],
        tabBarInactiveTintColor: palette.zinc[400],
        tabBarStyle: {
          backgroundColor: dark ? palette.zinc[950] : palette.white,
          borderTopColor: dark ? palette.zinc[700] : palette.zinc[200],
          height: 56 + insets.bottom,
          paddingBottom: insets.bottom,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
        sceneStyle: { backgroundColor: dark ? palette.zinc[900] : palette.white },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "홈", tabBarIcon: ({ color, size }) => <House color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="papers/index"
        options={{ title: "기출문제", tabBarIcon: ({ color, size }) => <FileStack color={color} size={size} /> }}
      />
      <Tabs.Screen
        name="wrong-notes"
        options={{
          title: "오답노트",
          href: "/mypage?tab=wrong-notes",
          tabBarIcon: ({ color, size }) => <BookOpenCheck color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="mypage/index"
        options={{ title: "마이페이지", tabBarIcon: ({ color, size }) => <UserRound color={color} size={size} /> }}
      />
    </Tabs>
  );
}
