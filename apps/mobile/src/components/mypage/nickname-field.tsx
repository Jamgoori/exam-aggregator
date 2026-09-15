import { NICKNAME_MAX, NICKNAME_MIN } from "@gongmoa/core";
import { useState } from "react";
import { View } from "react-native";
import { AppText } from "../app-text";
import { Button } from "../button";
import { Input } from "../input";
import { checkNicknameAvailable, updateNickname } from "../../lib/profile";

// 마이페이지 수정 화면용 닉네임 칸(웹 nickname-field.tsx, 설계서 §4.5 #34·§7.1): 중복확인은 확인만
// 하고, "적용" 버튼을 눌러야 실제로 저장된다. 저장은 core validateNickname + RPC is_nickname_taken +
// auth.updateUser(lib/profile.ts — 트리거 문구·유니크 위반 매핑 포함).
export function NicknameField({ defaultValue = "" }: { defaultValue?: string }) {
  const [value, setValue] = useState(defaultValue);
  const [status, setStatus] = useState<"idle" | "ok" | "bad">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<"check" | "apply" | null>(null);

  async function handleCheck() {
    setMessage(null);
    setPending("check");
    try {
      const result = await checkNicknameAvailable(value);
      if (!result.available) {
        setStatus("bad");
        setMessage("이미 사용 중인 닉네임이에요.");
        return;
      }
      setStatus("ok");
      setMessage("사용 가능한 닉네임이에요.");
    } catch (e) {
      setStatus("bad");
      setMessage(e instanceof Error ? e.message : "닉네임 확인에 실패했어요.");
    } finally {
      setPending(null);
    }
  }

  async function handleApply() {
    if (status !== "ok") {
      setMessage("먼저 중복확인을 해주세요.");
      return;
    }
    setMessage(null);
    setPending("apply");
    try {
      await updateNickname(value);
      setStatus("ok");
      setMessage("닉네임을 변경했어요.");
    } catch (e) {
      setStatus("bad");
      setMessage(e instanceof Error ? e.message : "닉네임 저장에 실패했어요.");
    } finally {
      setPending(null);
    }
  }

  return (
    <View className="gap-1">
      <AppText variant="sm" className="text-zinc-600 dark:text-zinc-400" nativeID="edit-nickname-label">
        닉네임
      </AppText>
      <Input
        value={value}
        onChangeText={(v) => {
          setValue(v);
          setStatus("idle");
          setMessage(null);
        }}
        maxLength={NICKNAME_MAX}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabelledBy="edit-nickname-label"
        className="rounded"
      />
      <View className="mt-1 flex-row gap-2">
        <Button
          variant="outline"
          label="중복확인"
          pending={pending === "check"}
          disabled={pending !== null || !value}
          onPress={() => void handleCheck()}
          className="flex-1 rounded px-3 py-2"
          textClassName="font-medium text-zinc-600 dark:text-zinc-400"
        />
        <Button
          label="적용"
          pending={pending === "apply"}
          disabled={pending !== null || !value || status !== "ok"}
          onPress={() => void handleApply()}
          className="flex-1 rounded px-3 py-2"
          textClassName="font-medium"
        />
      </View>
      <AppText variant="xs" className="mt-1 text-zinc-400 dark:text-zinc-500">
        {NICKNAME_MIN}~{NICKNAME_MAX}자로 입력해주세요.
      </AppText>
      {message && (
        <AppText
          variant="sm"
          accessibilityRole={status === "bad" ? "alert" : undefined}
          className={status === "bad" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}
        >
          {message}
        </AppText>
      )}
    </View>
  );
}
