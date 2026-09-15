import type { CbtViewMode } from "@gongmoa/core";
import { Check, Lock, LockOpen, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { kvGet, kvSet } from "../../lib/kv";
import { updateCbtViewMode } from "../../lib/profile";
import { themedIcon } from "../../theme/icons";

// 자물쇠(웹 cbt-view-mode-lock.tsx 1:1): 지금 보고 있는 모드를 계정의 기본 시작 모드로 저장하는
// 토글. 저장처는 웹과 같은 user_metadata.default_cbt_view_mode(lib/profile.ts updateCbtViewMode).
// 저장된 기본값은 부모가 든다(낙관적 갱신·실패 시 되돌림). 첫 방문 안내 말풍선은 kv
// `cbt-lock-hint-dismissed`(웹 localStorage 키 그대로) + "이번 방문에 이미 띄움" 모듈 변수.
const LockIcon = themedIcon(Lock);
const LockOpenIcon = themedIcon(LockOpen);
const CloseIcon = themedIcon(X);
const CheckIcon = themedIcon(Check);

let lockHintShownThisVisit = false;

export function ViewModeLock({
  viewMode,
  savedDefaultViewMode,
  onSavedDefaultViewModeChange,
}: {
  viewMode: CbtViewMode;
  savedDefaultViewMode: CbtViewMode | null;
  onSavedDefaultViewModeChange: (next: CbtViewMode | null) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // 처음 들어왔을 때 한 번 말풍선으로 짚어준다(600ms 지연 — 로딩 직후 다른 UI 와 뒤섞이지 않게).
  useEffect(() => {
    if (lockHintShownThisVisit) return;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    let alive = true;
    kvGet("cbt-lock-hint-dismissed").then((v) => {
      if (!alive || v) return;
      timeout = setTimeout(() => {
        lockHintShownThisVisit = true;
        setHintVisible(true);
      }, 600);
    });
    return () => {
      alive = false;
      if (timeout) clearTimeout(timeout);
    };
  }, []);

  function dismissHint(persist: boolean) {
    setHintVisible(false);
    if (persist) void kvSet("cbt-lock-hint-dismissed", "1");
  }

  const locked = savedDefaultViewMode === viewMode;

  async function toggle() {
    if (saving) return;
    if (hintVisible) dismissHint(true);
    const previous = savedDefaultViewMode;
    // 이미 잠긴 상태에서 다시 누르면 저장값을 지워(null) 해제한다.
    const next = locked ? null : viewMode;
    onSavedDefaultViewModeChange(next);
    setSaving(true);
    try {
      await updateCbtViewMode(next);
    } catch {
      onSavedDefaultViewModeChange(previous);
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="relative">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={locked ? "저장된 시작 모드 해제하기" : "이 모드를 시작 모드로 저장"}
        accessibilityHint={
          locked ? "다음 온라인 응시부터 이 모드로 시작해요. 누르면 해제해요" : "누르면 다음 온라인 응시부터 이 모드로 시작해요"
        }
        accessibilityState={{ selected: locked, disabled: saving }}
        disabled={saving}
        onPress={() => void toggle()}
        className={[
          "h-7 w-7 items-center justify-center rounded-full",
          locked ? "bg-blue-600" : "active:bg-zinc-100 dark:active:bg-zinc-800",
          saving ? "opacity-50" : "",
        ].join(" ")}
      >
        {locked ? (
          <LockIcon size={16} colorClassName="text-white" />
        ) : (
          <LockOpenIcon size={16} colorClassName="text-zinc-400 dark:text-zinc-600" />
        )}
      </Pressable>

      {hintVisible && (
        <View
          style={{ zIndex: 30, elevation: 30 }}
          className="absolute left-1/2 top-full mt-2 w-56 -translate-x-1/2 rounded-xl bg-blue-600 p-3 shadow-lg shadow-blue-600/30"
        >
          <View className="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 bg-blue-600" />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="안내 닫기"
            onPress={() => dismissHint(dontShowAgain)}
            className="absolute right-2 top-2 z-10 p-0.5"
          >
            <CloseIcon size={14} colorClassName="text-blue-200" />
          </Pressable>
          <AppText variant="xs" weight="medium" className="pr-4 text-white" style={{ lineHeight: 18 }}>
            자물쇠를 누르면 이 모드를 기본값으로 저장해요. 다음 응시부터 바로 이 화면으로 열려요.
          </AppText>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: dontShowAgain }}
            onPress={() => setDontShowAgain((v) => !v)}
            className="mt-2 flex-row items-center gap-1.5"
          >
            <View
              className={[
                "h-3 w-3 items-center justify-center rounded-sm border border-white",
                dontShowAgain ? "bg-white" : "",
              ].join(" ")}
            >
              {dontShowAgain && <CheckIcon size={10} colorClassName="text-blue-600" strokeWidth={3} />}
            </View>
            <AppText variant="11" className="text-blue-100">
              다시 보지 않기
            </AppText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
