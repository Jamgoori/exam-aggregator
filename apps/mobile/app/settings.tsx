import { Stack, useRouter } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { signOut } from "../src/lib/auth";
import { deleteAccount } from "../src/lib/account";
import { LEGAL_LABELS, openLegal, type LegalDoc } from "../src/lib/legal";
import { useAuth } from "../src/providers/auth-provider";
import { colors } from "../src/theme/colors";

// 설정: 약관·처리방침 열람과 계정 정리(로그아웃·탈퇴). 스토어 심사에서 "계정 삭제 경로가
// 앱 안에 있는지"를 여기로 확인한다.
export default function SettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [deleting, setDeleting] = useState(false);

  async function openDoc(doc: LegalDoc) {
    try {
      await openLegal(doc);
    } catch (e) {
      Alert.alert("문서를 열 수 없어요", e instanceof Error ? e.message : "");
    }
  }

  // 되돌릴 수 없는 작업이라 두 단계로 확인받는다.
  function confirmDelete() {
    Alert.alert(
      "회원 탈퇴",
      "탈퇴하면 응시 기록·오답노트·메모·즐겨찾기가 모두 삭제되고 복구할 수 없어요.\n작성한 댓글은 '탈퇴한 회원'으로 남습니다.",
      [
        { text: "취소", style: "cancel" },
        { text: "계속", style: "destructive", onPress: confirmDeleteFinal },
      ],
    );
  }

  function confirmDeleteFinal() {
    Alert.alert("정말 탈퇴할까요?", "이 작업은 되돌릴 수 없습니다.", [
      { text: "취소", style: "cancel" },
      { text: "탈퇴하기", style: "destructive", onPress: runDelete },
    ]);
  }

  async function runDelete() {
    try {
      setDeleting(true);
      await deleteAccount();
      // 세션이 사라지면 마이페이지가 로그인 안내로 돌아간다.
      router.replace("/(tabs)/mypage");
      Alert.alert("탈퇴 완료", "이용해 주셔서 감사합니다.");
    } catch (e) {
      Alert.alert("탈퇴 실패", e instanceof Error ? e.message : "다시 시도해 주세요.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: true, title: "설정" }} />
      <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
        <SectionLabel text="약관" />
        <Row label={LEGAL_LABELS.terms} onPress={() => openDoc("terms")} />
        <Row label={LEGAL_LABELS.privacy} onPress={() => openDoc("privacy")} />

        {session && (
          <>
            <SectionLabel text="계정" />
            <Row
              label="로그아웃"
              onPress={() => {
                signOut().catch(() => {});
                router.replace("/(tabs)/mypage");
              }}
            />
            {deleting ? (
              <View style={{ paddingHorizontal: 16, paddingVertical: 14 }}>
                <ActivityIndicator />
              </View>
            ) : (
              <Row label="회원 탈퇴" danger onPress={confirmDelete} />
            )}
            <Text
              style={{
                color: colors.textMuted,
                fontSize: 12,
                lineHeight: 18,
                paddingHorizontal: 16,
                paddingTop: 10,
              }}
            >
              탈퇴하면 응시 기록·오답노트·메모·즐겨찾기가 즉시 삭제되고 복구할 수 없어요.
              작성한 댓글은 다른 이용자의 답글이 끊기지 않도록 &lsquo;탈퇴한 회원&rsquo;
              이름으로 남습니다.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

function SectionLabel({ text }: { text: string }) {
  return (
    <Text
      style={{
        color: colors.textMuted,
        fontSize: 12,
        paddingHorizontal: 16,
        paddingTop: 18,
        paddingBottom: 6,
      }}
    >
      {text}
    </Text>
  );
}

function Row({
  label,
  onPress,
  danger,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 16,
        paddingVertical: 14,
        borderTopWidth: 1,
        borderTopColor: colors.border,
      }}
    >
      <Text style={{ flex: 1, color: danger ? colors.danger : colors.text }}>{label}</Text>
      <Text style={{ color: colors.textMuted }}>›</Text>
    </Pressable>
  );
}
