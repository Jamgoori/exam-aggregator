import NetInfo from "@react-native-community/netinfo";
import { useEffect, useState } from "react";

// 네트워크 상태. "연결됨"만으로는 부족해서(카페 와이파이처럼 붙었지만 인터넷이 안 되는
// 경우) isInternetReachable 까지 본다. 판정 전(null)에는 온라인으로 가정한다 — 처음
// 몇 백 ms 동안 오프라인 배너가 깜빡이는 게 더 거슬리기 때문.
export function useIsOnline(): boolean {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setOnline(!!state.isConnected && reachable !== false);
    });
    return unsubscribe;
  }, []);

  return online;
}
