import { router } from "expo-router";
import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Input } from "../input";
import { deleteAccount } from "../../lib/account";

// 회원 탈퇴(웹 delete-account-button.tsx, 설계서 §7.1). 실제 삭제는 Edge Function(account-delete)이
// 하고 웹·앱이 같은 함수를 부른다(lib/account.ts — 성공 후 로컬 signOut + 캐시·persister·kv me:*
// 정리까지). 되돌릴 수 없는 작업이라 "탈퇴" 문구를 직접 입력받는 2단계 확인을 거친다.
// 탈퇴 정책 확장(스토리지 객체·cascade 범위)은 Phase 4(§12-2 #17) — 여기서 바꾸지 않는다.
const CONFIRM_PHRASE = "탈퇴";

export function DeleteAccountButton() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      router.replace("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "탈퇴 처리에 실패했어요.");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <Pressable accessibilityRole="button" onPress={() => setOpen(true)} className="self-start py-1">
        <AppText variant="sm" className="text-red-600 underline dark:text-red-400">
          회원 탈퇴
        </AppText>
      </Pressable>
    );
  }

  return (
    <View className="gap-3 rounded border border-red-200 p-4 dark:border-red-900/60">
      <AppText variant="sm" className="text-zinc-700 dark:text-zinc-300" pretty>
        탈퇴하면 응시 기록·오답노트·메모·즐겨찾기가 즉시 삭제되고 복구할 수 없어요. 작성한 댓글은 다른
        이용자의 답글이 끊기지 않도록 ‘탈퇴한 회원’ 이름으로 남습니다.
      </AppText>
      <View className="gap-1">
        <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" nativeID="delete-confirm-label">
          계속하려면{" "}
          <AppText variant="sm" weight="bold" className="text-zinc-800 dark:text-zinc-200">
            {CONFIRM_PHRASE}
          </AppText>
          를 입력하세요.
        </AppText>
        <Input
          value={phrase}
          onChangeText={setPhrase}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          accessibilityLabelledBy="delete-confirm-label"
          className="rounded"
        />
      </View>

      {error && (
        <AppText variant="sm" className="text-red-600 dark:text-red-400" accessibilityRole="alert" pretty>
          {error}
        </AppText>
      )}

      <View className="flex-row gap-2">
        <Button
          variant="danger"
          label={busy ? "탈퇴 처리 중..." : "탈퇴하기"}
          pending={busy}
          disabled={busy || phrase.trim() !== CONFIRM_PHRASE}
          onPress={() => void run()}
          className="rounded px-4 py-2"
          textClassName="font-normal"
        />
        <Button
          variant="outline"
          label="취소"
          disabled={busy}
          onPress={() => {
            setOpen(false);
            setPhrase("");
            setError(null);
          }}
          className="rounded px-4 py-2"
          textClassName="font-normal"
        />
      </View>
    </View>
  );
}
