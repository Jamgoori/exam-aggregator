import * as Haptics from "expo-haptics";

// 햅틱은 웹에 없는 플랫폼 적응(설계서 §4.3). 기본은 선택지 탭 selectionAsync, 채점 완료
// notificationAsync(Success) 둘뿐이고 설정에서 끌 수 있다(토글 저장은 /mypage/edit 이식 때).
let enabled = true;

export function setHapticsEnabled(v: boolean): void {
  enabled = v;
}

export function isHapticsEnabled(): boolean {
  return enabled;
}

export function hapticSelect(): void {
  if (!enabled) return;
  Haptics.selectionAsync().catch(() => {});
}

export function hapticSuccess(): void {
  if (!enabled) return;
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
