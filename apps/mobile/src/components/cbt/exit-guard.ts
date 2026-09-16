import { useCallback, useEffect } from "react";
import { Alert, BackHandler } from "react-native";

// 이탈 확인(설계서 §4.5 #22 끝, §4.4 몰입 화면). 웹 useLeaveConfirmation 의 beforeunload/
// 링크 가로채기 대신 — 자체 뒤로가기 버튼 + Android 하드웨어 뒤로가기(BackHandler) + Alert.
// iOS 가장자리 스와이프·Android 예측 뒤로가기는 Screen immersive 의 Stack.Screen 옵션이 이미
// 끈다(BackHandler 는 iOS 스와이프를 잡지 못하고 beforeRemove 는 쓰지 않는다).
// 채점이 끝나면(active=false) 더 잃을 게 없으니 풀어준다.
export const LEAVE_CONFIRM_MESSAGE =
  "지금 나가면 저장되지 않고 풀이 중인 내용이 모두 사라져요. 그래도 나갈까요?";

// message: 화면마다 다른 확인 문구(복습 솔버는 웹과 같은 "이어서 풀 수 있어요" 판).
export function useExitGuard(active: boolean, leave: () => void, message: string = LEAVE_CONFIRM_MESSAGE) {
  const confirmLeave = useCallback(() => {
    if (!active) {
      leave();
      return;
    }
    Alert.alert(message, undefined, [
      { text: "취소", style: "cancel" },
      { text: "나가기", style: "destructive", onPress: leave },
    ]);
  }, [active, leave, message]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmLeave();
      // 항상 우리가 처리한다(active 가 아니면 confirmLeave 가 곧바로 leave 를 부른다).
      return true;
    });
    return () => sub.remove();
  }, [confirmLeave]);

  return confirmLeave;
}
