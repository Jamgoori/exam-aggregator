import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

// OS 의 "동작 줄이기"(iOS 손쉬운 사용 > 동작, Android 접근성 > 애니메이션 제거) = 웹의
// `prefers-reduced-motion` 자리(설계서 §4.3 모션 매핑 마지막 줄).
//
// Reanimated 에도 `useReducedMotion()` 이 있지만 그것은 **앱이 켜질 때 읽은 값**을 돌려주는
// 모듈 상수라 설정이 바뀌어도 리렌더가 일어나지 않는다(react-native-reanimated
// `hook/useReducedMotion.js`). 설정을 켜고 앱으로 돌아온 그 자리에서 바로 효과가 보여야 하는
// 쓰임(복습 안내 시트의 타임라인, 테마 전환)은 이 훅을 쓴다. 반대로 마운트 때 한 번 시작하고
// 마는 장식용 반복(`Skeleton`, CBT 전체보기)은 시작 시점 값으로 충분해 Reanimated 판을 그대로 쓴다.
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduce(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduce;
}
