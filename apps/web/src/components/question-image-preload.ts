"use client";

import { useEffect, useRef } from "react";
import { createImagePreloadQueue } from "@/lib/image-preload-queue";

// 문제별 풀기(CBT)와 오답 다시 풀기가 함께 쓰는 "문항 이미지 미리받기" 훅.
// 순서·동시 개수 규칙은 image-preload-queue가 갖고, 여기서는 그 규칙대로 실제
// 브라우저 요청(Image)을 만들어준다. 한 번 받아둔 이미지는 브라우저 캐시에 남아
// 문항을 넘길 때 곧바로 그려진다.
export function useQuestionImagePreload({
  enabled,
  imagesByItem,
  currentIndex,
}: {
  // 문제별 보기를 보고 있는 동안에만 켠다(전체보기·채점 결과 화면에서는 필요 없다).
  enabled: boolean;
  // 문항 순서대로 담은 이미지 주소 목록. 참조가 바뀔 때마다 순서를 다시 매기므로
  // 호출하는 쪽에서 useMemo로 고정해 넘긴다.
  imagesByItem: string[][];
  currentIndex: number;
}) {
  // start 콜백은 큐가 만들어질 때 한 번만 잡히므로, 지금 보고 있는 문항 번호는
  // ref로 읽는다(문항을 넘길 때마다 큐를 새로 만들면 받아둔 기록이 날아간다).
  const currentIndexRef = useRef(currentIndex);
  const queueRef = useRef<ReturnType<typeof createImagePreloadQueue> | null>(null);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    if (!enabled) return;
    const queue = createImagePreloadQueue({
      start: (target, done) => {
        const img = new Image();
        img.decoding = "async";
        // 지금 보고 있는 문항은 화면에 그려질 그 이미지라 높은 우선순위로 받고,
        // 뒤에서 채워두는 나머지는 low로 둬서 눈앞의 문항을 밀어내지 않게 한다.
        img.fetchPriority = target.itemIndex === currentIndexRef.current ? "high" : "low";
        img.onload = done;
        // 실패해도 다음 장으로 넘어간다 — 화면에 그려지는 <img>가 어차피 다시
        // 요청하므로, 여기서 붙잡고 재시도할 이유가 없다.
        img.onerror = done;
        img.src = target.src;
        // 이미 캐시에 있으면 onload가 아예 안 불릴 수 있다(즉시 complete).
        if (img.complete) done();
      },
    });
    queueRef.current = queue;
    return () => {
      queue.stop();
      queueRef.current = null;
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    queueRef.current?.prioritize(imagesByItem, currentIndex);
  }, [enabled, imagesByItem, currentIndex]);
}
