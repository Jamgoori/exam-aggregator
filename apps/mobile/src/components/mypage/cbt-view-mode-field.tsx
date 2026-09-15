import { useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { updateCbtViewMode, type CbtViewMode } from "../../lib/profile";

// "CBT 시작 화면"(웹 cbt-view-mode-field.tsx, 설계서 §4.5 #34): 온라인 응시를 시작할 때 어느
// 화면으로 열지. 값은 user_metadata.default_cbt_view_mode(웹과 공유). 웹은 두 값만 고르지만
// 앱은 null(잠금 없음 = 사이트 기본 문제별)로 되돌리는 것도 지원한다(§7.1).
const OPTIONS: { value: CbtViewMode; label: string }[] = [
  { value: "full", label: "전체보기" },
  { value: "single", label: "문제별 풀기" },
];

export function CbtViewModeField({ defaultValue }: { defaultValue: CbtViewMode | null }) {
  const [mode, setMode] = useState<CbtViewMode | null>(defaultValue);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  // 계정에 명시적으로 잠긴 값이 없으면 사이트 기본값인 "문제별 풀기"를 켜진 것으로 보여준다
  // (CbtSolver 의 시작 모드 결정 로직과 동일한 기본값).
  const shown: CbtViewMode = mode === "full" ? "full" : "single";

  async function select(next: CbtViewMode | null) {
    if (next === mode || pending) return;
    setMessage(null);
    setPending(true);
    try {
      await updateCbtViewMode(next);
      setMode(next);
      setMessage({ tone: "ok", text: "저장했어요." });
    } catch (e) {
      setMessage({ tone: "bad", text: e instanceof Error ? e.message : "설정 저장에 실패했어요." });
    } finally {
      setPending(false);
    }
  }

  return (
    <View className="gap-2">
      <AppText variant="sm" className="text-zinc-500 dark:text-zinc-500" pretty>
        온라인 응시를 시작할 때 어느 화면으로 열지 선택해요.
      </AppText>
      <View className="flex-row gap-2">
        {OPTIONS.map((o) => {
          const active = shown === o.value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active, disabled: pending }}
              disabled={pending}
              onPress={() => void select(o.value)}
              className={[
                "flex-1 items-center rounded-lg border px-3 py-2",
                active
                  ? "border-blue-600 bg-blue-50 dark:bg-blue-950/40"
                  : "border-zinc-300 active:bg-zinc-50 dark:border-zinc-700 dark:active:bg-zinc-800/50",
                pending ? "opacity-50" : "",
              ].join(" ")}
            >
              <AppText variant="sm" weight="medium" className={active ? "text-blue-600 dark:text-blue-400" : "text-zinc-600 dark:text-zinc-400"}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {/* 앱 전용: 잠근 값을 지워 사이트 기본값으로(§7.1 null 해제). 잠긴 값이 있을 때만 보인다. */}
      {mode !== null && (
        <Pressable accessibilityRole="button" disabled={pending} onPress={() => void select(null)} className="self-start py-1">
          <AppText variant="xs" className="text-zinc-500 underline dark:text-zinc-400">
            기본값으로 되돌리기(잠금 해제)
          </AppText>
        </Pressable>
      )}
      {message && (
        <AppText
          variant="sm"
          accessibilityRole={message.tone === "bad" ? "alert" : undefined}
          className={message.tone === "bad" ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}
        >
          {message.text}
        </AppText>
      )}
    </View>
  );
}
