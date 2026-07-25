import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// 복습 리마인더 — 기기 안에서 예약하는 로컬 알림이다.
//
// 원격 푸시(FCM/APNs)가 아닌 이유: 원격은 Firebase·Apple 인증서와 기기 토큰을 저장할
// 테이블·발송 서버가 필요한데, 이 알림에 필요한 정보(내가 안 푼 오답이 남아 있다)는
// 전부 기기에 있다. 서버 없이도 같은 효과가 난다. 원격 푸시는 "다른 사람이 내 댓글에
// 답글을 달았다" 같은 서버발 이벤트가 생길 때 추가하면 된다.
const CHANNEL_ID = "study-reminder";

// 하루 한 번, 저녁에. 이미 예약된 게 있으면 갈아끼운다(중복 알림 방지).
const REMINDER_HOUR = 20;

export async function ensureNotificationSetup(): Promise<void> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: "학습 리마인더",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
}

// 권한은 사용자가 리마인더를 켤 때만 묻는다(앱을 켜자마자 묻지 않는다 — 거절률이 높다).
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

export async function scheduleDailyReminder(unresolvedCount: number): Promise<void> {
  await ensureNotificationSetup();
  await cancelDailyReminder();

  await Notifications.scheduleNotificationAsync({
    content: {
      title: "오늘 복습했나요?",
      body:
        unresolvedCount > 0
          ? `아직 극복 못 한 오답이 ${unresolvedCount}개 있어요.`
          : "오답노트를 열어 오늘 분량을 확인해 보세요.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: REMINDER_HOUR,
      minute: 0,
      channelId: CHANNEL_ID,
    },
  });
}

export async function cancelDailyReminder(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export async function hasScheduledReminder(): Promise<boolean> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  return scheduled.length > 0;
}
