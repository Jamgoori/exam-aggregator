import { useEffect, useState } from "react";
import { Pressable, View } from "react-native";
import { AppText } from "../app-text";
import { cancelDailyReminder, hasScheduledReminder, requestNotificationPermission, scheduleDailyReminder } from "../../lib/reminders";

// 복습 리마인더 토글(앱 전용 유지 — 설계서 §7.1 "리마인더 토글(앱 전용 유지)", §10 reminders.ts).
// 기기 안 로컬 알림이라 서버 상태가 없다: 켜짐 여부는 예약 존재(REMINDER_ID)로 판정한다.
// 토글 스위치 트랙 `h-6 w-11` 은 웹 규격(§4.5 #26). 권한은 켤 때만 묻는다.
export function ReminderToggle({ unresolvedCount }: { unresolvedCount: number }) {
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    hasScheduledReminder().then((v) => {
      if (alive) setOn(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    if (on === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (on) {
        await cancelDailyReminder();
        setOn(false);
      } else {
        const granted = await requestNotificationPermission();
        if (!granted) {
          setError("알림 권한이 필요해요. 기기 설정에서 공모아 알림을 허용해 주세요.");
          return;
        }
        await scheduleDailyReminder(unresolvedCount);
        setOn(true);
      }
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : "리마인더 설정에 실패했어요.");
    } finally {
      setBusy(false);
    }
  }

  const checked = on === true;
  return (
    <View className="gap-2">
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked, disabled: busy || on === null }}
        accessibilityLabel="복습 리마인더"
        disabled={busy || on === null}
        onPress={() => void toggle()}
        className="flex-row items-center justify-between gap-3"
      >
        <View className="min-w-0 flex-1">
          <AppText variant="sm" weight="medium">
            복습 리마인더
          </AppText>
          <AppText variant="xs" className="mt-0.5 text-zinc-500 dark:text-zinc-500" pretty>
            매일 저녁 8시에 남은 오답을 알려드려요. 기기 안에서만 울리는 알림이에요.
          </AppText>
        </View>
        <View
          className={[
            "h-6 w-11 shrink-0 justify-center rounded-full px-0.5",
            checked ? "bg-blue-600" : "bg-zinc-300 dark:bg-zinc-600",
            busy || on === null ? "opacity-50" : "",
          ].join(" ")}
        >
          <View className={["h-5 w-5 rounded-full bg-white shadow-sm", checked ? "self-end" : "self-start"].join(" ")} />
        </View>
      </Pressable>
      {error && (
        <AppText variant="sm" className="text-red-600 dark:text-red-400" accessibilityRole="alert" pretty>
          {error}
        </AppText>
      )}
    </View>
  );
}
