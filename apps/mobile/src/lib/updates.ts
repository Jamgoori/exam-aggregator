import * as Updates from "expo-updates";

// OTA 업데이트. expo-updates 는 app.json 에 채널·URL 까지 설정돼 있었지만 코드에서 한
// 번도 부르지 않아 실제로는 안 받아왔다. 스토어 심사를 다시 타지 않고 JS 수정본을
// 내보내는 통로라, 앱이 포그라운드로 올 때 확인한다.
//
// 받자마자 재시작하지는 않는다 — 문제를 풀던 중에 화면이 날아가면 답안이 사라진다.
// 다음 실행에 자동 적용되므로 조용히 내려받기만 한다.
export async function checkForUpdate(): Promise<void> {
  // 개발 빌드(dev client)에서는 항상 실패하므로 아예 건너뛴다.
  if (__DEV__ || !Updates.isEnabled) return;
  try {
    const result = await Updates.checkForUpdateAsync();
    if (result.isAvailable) {
      await Updates.fetchUpdateAsync();
    }
  } catch {
    // 네트워크가 없거나 채널이 없으면 조용히 무시 — 앱 동작과 무관하다.
  }
}
