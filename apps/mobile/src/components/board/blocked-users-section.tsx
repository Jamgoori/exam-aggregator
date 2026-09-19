import { useState } from "react";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { useBlockedUsers, useUnblockUser } from "../../queries/board";

// 내 정보 수정의 "차단한 사용자" 절 — **웹에 없는 화면**(설계서 §6.7 #18). 차단한 사용자의 글·댓글은
// 어디에도 보이지 않으므로 해제할 자리가 여기밖에 없다. 문구는 짧고 사실만.
//
// 닉네임은 매번 서버에서 읽는다(RPC my_blocked_users 가 profiles 에서 붙여 준다) — 차단 시점의 닉네임을
// 앱이 저장해 두면 닉네임이 바뀐 뒤 낡은 이름이 남는다.

export function BlockedUsersSection() {
  const users = useBlockedUsers();
  const unblock = useUnblockUser();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = users.data ?? [];

  if (users.isPending) {
    return (
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
        차단 목록을 불러오는 중…
      </AppText>
    );
  }

  return (
    <View className="gap-3">
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500">
        {list.length > 0 ? `차단한 사용자 ${list.length}명` : "차단한 사용자가 없어요."}
      </AppText>

      {list.length > 0 && (
        <View className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-700">
          {list.map(({ userId: id, nickname }, i) => (
            <View
              key={id}
              className={[
                "flex-row items-center justify-between gap-3 px-4 py-2.5",
                i > 0 ? "border-t border-zinc-100 dark:border-zinc-800" : "",
              ].join(" ")}
            >
              <AppText variant="sm" className="text-zinc-700 dark:text-zinc-300">
                {nickname}
              </AppText>
              <Button
                variant="outline"
                label="해제"
                pending={busyId === id}
                disabled={busyId !== null}
                onPress={() => {
                  setError(null);
                  setBusyId(id);
                  unblock.mutate(id, {
                    onError: (e) => setError(e.message),
                    onSettled: () => setBusyId(null),
                  });
                }}
                className="rounded-lg px-3 py-1.5"
                textClassName="text-xs"
              />
            </View>
          ))}
        </View>
      )}

      {users.isError && !error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {users.error.message}
        </AppText>
      )}
      {error && (
        <AppText variant="sm" accessibilityRole="alert" className="text-red-600 dark:text-red-400">
          {error}
        </AppText>
      )}
    </View>
  );
}
