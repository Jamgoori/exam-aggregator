import { Tabs } from "expo-router";
import { colors } from "../../src/theme/colors";

// 하단 탭: 홈(문제지 둘러보기) / 검색 / 마이페이지. 웹 site-header 네비를 앱 관습에 맞춰 탭으로.
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        headerStyle: { backgroundColor: colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "홈" }} />
      <Tabs.Screen name="search" options={{ title: "검색" }} />
      <Tabs.Screen name="mypage" options={{ title: "마이페이지" }} />
    </Tabs>
  );
}
