import { useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { signOut } from "../../src/lib/auth";
import { useAuth } from "../../src/providers/auth-provider";
import { colors } from "../../src/theme/colors";

// 마이페이지: 로그인 게이트 예시. 비로그인이면 로그인 유도, 로그인이면 프로필+로그아웃.
// TODO: 웹 mypage(응시기록·오답노트·AI진단) 이식.
export default function MyPageScreen() {
  const { session } = useAuth();
  const router = useRouter();

  if (!session) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12, padding: 24 }}>
        <Text style={{ color: colors.textMuted }}>로그인이 필요해요.</Text>
        <Pressable
          onPress={() => router.push("/(auth)/login")}
          style={{
            backgroundColor: colors.primary,
            borderRadius: 10,
            paddingHorizontal: 20,
            paddingVertical: 10,
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "500" }}>로그인</Text>
        </Pressable>
      </View>
    );
  }

  const nickname =
    (session.user.user_metadata?.nickname as string | undefined) ??
    session.user.email ??
    "회원";

  return (
    <View style={{ flex: 1, padding: 24, gap: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "600" }}>{nickname}</Text>
      <Text style={{ color: colors.textMuted }}>
        응시 기록 · 오답노트 · AI 진단 (이식 예정)
      </Text>
      <Pressable
        onPress={signOut}
        style={{
          alignSelf: "flex-start",
          borderWidth: 1,
          borderColor: colors.border,
          borderRadius: 10,
          paddingHorizontal: 16,
          paddingVertical: 8,
        }}
      >
        <Text style={{ color: colors.danger }}>로그아웃</Text>
      </Pressable>
    </View>
  );
}
