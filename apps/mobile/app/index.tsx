import { Redirect } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import { useAuth } from "../src/providers/auth-provider";

// 앱 진입점: 세션 로딩 중엔 스피너, 끝나면 탭으로. 로그인은 화면별로 게이트한다
// (웹처럼 목록·상세는 비로그인도 열람 가능, CBT/마이페이지만 로그인 필요).
export default function Index() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  return <Redirect href="/(tabs)" />;
}
