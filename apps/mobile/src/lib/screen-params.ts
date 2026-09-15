import { useNavigation } from "expo-router";
import { useCallback } from "react";

// 화면 스코프 setParams. 전역 `router.setParams` 는 "지금 포커스된 라우트"에 쓰므로 디바운스
// 효과·늦게 끝난 콜백이 다른 화면으로 넘어간 뒤 실행되면 엉뚱한 라우트의 주소를 오염시킨다 —
// 화면의 navigation 객체로 자기 라우트에만 쓰고, 포커스가 없으면 버린다. undefined 값은
// 그 파라미터를 지운다(router.setParams 와 같은 규칙).
export function useSetScreenParams() {
  const navigation = useNavigation();
  return useCallback(
    (params: Record<string, string | undefined>) => {
      if (!navigation.isFocused()) return;
      (navigation as unknown as { setParams: (next: object) => void }).setParams(params);
    },
    [navigation],
  );
}
