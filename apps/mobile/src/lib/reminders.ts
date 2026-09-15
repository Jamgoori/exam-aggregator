import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

// 복습 리마인더 — 기기 안에서 예약하는 로컬 알림이다.
//
// 원격 푸시(FCM/APNs)가 아닌 이유: 원격은 Firebase·Apple 인증서와 기기 토큰을 저장할
// 테이블·발송 서버가 필요한데, 이 알림에 필요한 정보(내가 안 푼 오답이 남아 있다)는
// 전부 기기에 있다. 소유자 결정(§12-2 15번)으로 원격 푸시는 도입하지 않는다.
//
// 식별자 기준(§10): 예약·취소·존재 판정을 전부 REMINDER_ID 로 한다. 예전의
// cancelAllScheduledNotificationsAsync 는 다른 로컬 알림까지 지우고, "예약 개수 > 0" 판정은
// 다른 알림이 생기면 오판했다.
const CHANNEL_ID = "study-reminder";
const REMINDER_ID = "study-reminder";

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

// unresolvedCount 는 ['me', userId, 'wrong-notes'] 쿼리의 마지막 사본에서 읽어 채점 성공·
// 로그인 시 재예약, 로그아웃 시 취소(§10).
export async function scheduleDailyReminder(unresolvedCount: number): Promise<void> {
  await ensureNotificationSetup();
  await cancelDailyReminder();

  await Notifications.scheduleNotificationAsync({
    identifier: REMINDER_ID,
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
  try {
    await Notifications.cancelScheduledNotificationAsync(REMINDER_ID);
  } catch {
    // 예약이 없거나 권한이 없어도 실패가 아니다.
  }
}

export async function hasScheduledReminder(): Promise<boolean> {
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    return scheduled.some((n) => n.identifier === REMINDER_ID);
  } catch {
    return false;
  }
}
