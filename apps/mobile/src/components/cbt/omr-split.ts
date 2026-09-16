import { useCallback, useEffect, useState } from "react";
import type { LayoutChangeEvent } from "react-native";
import { Gesture } from "react-native-gesture-handler";
import { useSharedValue } from "react-native-reanimated";
import { kvGet, kvSet } from "../../lib/kv";

// 전체보기에서 OMR 을 바텀시트로 덮는 대신 화면을 좌우로 쪼갤 때 오른쪽 OMR 이 차지하는 폭의
// 비율(웹 lib/cbt-omr-split.ts 1:1 — 값·kv 키 모두 같다). 너무 좁으면 5지선다 버튼이 눌리지
// 않고, 너무 넓으면 시험지가 안 보인다. 끌어서 정한 값은 기기에 남아 다음 시험에서도 같은 폭.
//
// 웹의 키보드 ←/→ 0.05 단계는 미이식(설계서 §4.5 #22 — 외장 키보드 전용).
export const OMR_SPLIT = { default: 0.42, min: 0.3, max: 0.7 } as const;

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
// 오른쪽으로 끌면(dx>0) 오른쪽 패널이 좁아지므로 비율에서 뺀다.
//
// 비율 상태는 솔버(CbtSolver)가 들고 있어 전체보기 ↔ 문제별 보기를 오가도 유지된다.
export function useOmrSplit() {
  const [ratio, setRatio] = useState<number>(OMR_SPLIT.default);
  const [containerWidth, setContainerWidth] = useState(0);
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

  const nextRatio = (translationX: number) =>
    clampOmrSplit(startRatio.value - translationX / (containerWidth || 1));

  const gesture = Gesture.Pan()
    .enabled(containerWidth > 0)
    // 12px 짜리 구분선이라 좌우로 손가락 여유를 준다(부모 안쪽이라 Android 에서도 먹는다).
    .hitSlop({ left: 12, right: 12 })
    .minDistance(0)
    .runOnJS(true)
    .onBegin(() => {
      startRatio.value = ratio;
    })
    .onUpdate((e) => {
      setRatio(nextRatio(e.translationX));
    })
    .onEnd((e) => {
      const next = nextRatio(e.translationX);
      setRatio(next);
      void storeOmrSplitRatio(next);
    });

  return { ratio, onContainerLayout, gesture };
}
