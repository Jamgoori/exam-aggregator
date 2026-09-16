import { useCallback, useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { kvGet, kvSet } from "../../lib/kv";

// 전체보기에서 OMR 을 바텀시트로 덮는 대신 화면을 좌우로 쪼갤 때 오른쪽 OMR 이 차지하는 폭의
// 비율(웹 lib/cbt-omr-split.ts 1:1 — 값·kv 키 모두 같다). 너무 좁으면 5지선다 버튼이 눌리지
// 않고, 너무 넓으면 시험지가 안 보인다. 끌어서 정한 값은 기기에 남아 다음 시험에서도 같은 폭.
//
// 웹의 키보드 ←/→ 0.05 단계는 미이식(설계서 §4.5 #22 — 외장 키보드 전용).
export const OMR_SPLIT = { default: 0.42, min: 0.3, max: 0.7 } as const;

// 구분선을 잡는 폭. 눈에 보이는 선은 2px 자국 하나지만(웹과 같은 굵기), 손가락으로 집을 수
// 있어야 해서 잡히는 영역은 이만큼 넓다. `hitSlop` 으로 넓히지 않는 이유는 아래 gesture 주석.
export const OMR_DIVIDER_WIDTH = 24;

export function clampOmrSplit(ratio: number): number {
  if (!Number.isFinite(ratio)) return OMR_SPLIT.default;
  return Math.min(OMR_SPLIT.max, Math.max(OMR_SPLIT.min, ratio));
}

// 저장값은 사용자가 지우거나 고친 저장소에서 오므로 언제든 쓰레기일 수 있다(웹과 같은 방어).
export async function readOmrSplitRatio(): Promise<number> {
  const raw = await kvGet("cbt:omr-split-ratio");
  return raw ? clampOmrSplit(Number.parseFloat(raw)) : OMR_SPLIT.default;
}

export async function storeOmrSplitRatio(ratio: number): Promise<void> {
  await kvSet("cbt:omr-split-ratio", String(clampOmrSplit(ratio)));
}

// 구분선을 끌어 폭을 바꾸는 훅. 웹은 pointer capture + clientX 였지만 앱은 **이동 거리**만
// 쓴다(컨테이너의 화면 좌표를 몰라도 되고, 손가락이 시험지 위로 넘어가도 안 끊긴다).
//
// 끄는 동안의 폭은 **공유값 + useAnimatedStyle** 로만 움직인다. 예전에는 onUpdate 마다 React
// setState 를 불렀는데, 그 한 번이 CbtSolver → FullView → Skia 캔버스까지 통째로 다시 그려
// 손가락을 따라오지 못했다(설계서 §4.5 #22 의 "필기 위에 뜨는 패널"이라 더 비싸다). React
// 상태·kv 기록은 손을 뗄 때 한 번만 한다 — 접근성 값(accessibilityValue)과 다음 실행의 폭은
// 그 값으로 충분하다.
//
// 비율 상태는 솔버(CbtSolver)가 들고 있어 전체보기 ↔ 문제별 보기를 오가도 유지된다.
export function useOmrSplit() {
  const [ratio, setRatio] = useState<number>(OMR_SPLIT.default);
  const [containerWidth, setContainerWidth] = useState(0);
  // 끄는 동안의 폭. 손을 떼면 같은 값이 ratio 로도 넘어가므로 되돌릴 필요가 없다.
  // `-1` 은 "아직 한 번도 끌지 않았다" = 아래 panelStyle 이 React 쪽 ratio 를 쓴다는 뜻
  // (저장된 폭은 비동기로 도착하는데, 공유값을 useEffect 에서 고치면 react-hooks/immutability
  //  가 제스처의 대입을 막는다 — 그래서 초기값 경로는 React 상태 하나로만 둔다).
  const dragRatio = useSharedValue<number>(-1);
  // 끌기 시작 시점의 비율(제스처 콜백이 렌더 중 ref 를 읽지 않도록 공유값에 둔다).
  const startRatio = useSharedValue<number>(OMR_SPLIT.default);

  // 저장된 폭은 비동기라 첫 렌더에서는 알 수 없다 — 기본값으로 그린 뒤 읽은 값으로 맞춘다.
  useEffect(() => {
    let alive = true;
    readOmrSplitRatio()
      .then((stored) => {
        if (alive) setRatio(stored);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const onContainerLayout = useCallback((e: LayoutChangeEvent) => {
    const { width } = e.nativeEvent.layout;
    setContainerWidth((prev) => (Math.abs(prev - width) < 1 ? prev : width));
  }, []);

  const panelStyle = useAnimatedStyle(() => {
    const value = dragRatio.value < 0 ? ratio : dragRatio.value;
    return { width: `${value * 100}%` };
  });

  const nextRatio = (translationX: number) =>
    clampOmrSplit(startRatio.value - translationX / (containerWidth || 1));

  const gesture = Gesture.Pan()
    .enabled(containerWidth > 0)
    // hitSlop 으로 넓히지 않는다: 구분선의 오른쪽은 OMR 패널이지만 왼쪽은 시험지라,
    // 왼쪽으로 12px 을 더 먹으면 시험지 오른쪽 가장자리의 필기·팬이 구분선에 먹힌다.
    // 대신 구분선 자체를 OMR_DIVIDER_WIDTH 로 잡고(눈에 보이는 선은 그 안의 2px 자국),
    // 가로로 뚜렷하게 움직였을 때만 활성화해 세로 제스처를 뺏지 않는다.
    .activeOffsetX([-4, 4])
    .runOnJS(true)
    .onBegin(() => {
      startRatio.value = ratio;
      dragRatio.value = ratio;
    })
    .onUpdate((e) => {
      dragRatio.value = nextRatio(e.translationX);
    })
    .onEnd((e) => {
      const next = nextRatio(e.translationX);
      dragRatio.value = next;
      setRatio(next);
      void storeOmrSplitRatio(next);
    });

  return { ratio, panelStyle, onContainerLayout, gesture };
}
