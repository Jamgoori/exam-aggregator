// 문제별 풀기(CBT)·오답 다시 풀기에서 문항 이미지를 미리 받아두는 큐.
//
// 예전에는 화면에 들어온 순간 전 문항 이미지를 한꺼번에 요청했다. 이러면 지금 보고
// 있는 1번 문제 이미지가 나머지 수십~수백 장과 같은 대역폭을 나눠 쓰게 돼서, 정작
// 눈앞의 문제가 늦게 뜬다(요청은 다 나갔는데 첫 장이 제일 늦게 끝나는 상황).
//
// 그래서 "지금 보는 문항부터 순서대로, 한 번에 몇 장씩만" 받는다. 앞 순서가 끝나야
// 다음 요청이 나가므로 눈앞의 문항이 항상 먼저 완성되고, 나머지는 그 뒤에서 계속
// 채워진다. 문항을 넘기면 그 지점 기준으로 남은 순서를 다시 매긴다(prioritize).
//
// DOM을 직접 만지지 않고 "한 장 받기 시작"을 콜백으로 받는다 — 테스트에서 가짜
// 로더로 순서·동시 개수를 확인할 수 있게 하기 위함이다.

// 한 번에 동시에 받을 이미지 수. 1이면 회선이 놀고, 너무 크면 옛날처럼 앞 장이
// 뒤 장들과 대역폭을 나눠 쓴다. 문항 이미지 한 장이 수십 KB라 4장이면 회선은 채우면서
// 눈앞의 문항이 밀리지도 않는 정도다.
const DEFAULT_CONCURRENCY = 4;

export type PreloadTarget = {
  src: string;
  // 이 이미지가 몇 번째 문항의 것인지(0-based). 호출하는 쪽이 지금 보고 있는 문항의
  // 이미지에만 높은 우선순위를 주는 데 쓴다.
  itemIndex: number;
};

// 받을 순서: 지금 보는 문항 → 뒤쪽 문항들 → 앞쪽 문항들(가까운 것부터).
// 문제 풀이는 거의 항상 앞으로 넘어가므로 뒤쪽을 먼저 채우고, 되돌아가는 경우를 위해
// 앞쪽은 현재 위치에서 가까운 순으로 뒤이어 받는다.
export function orderPreloadTargets(
  imagesByItem: string[][],
  currentIndex: number,
): PreloadTarget[] {
  const targets: PreloadTarget[] = [];
  const start = Math.min(Math.max(currentIndex, 0), Math.max(imagesByItem.length - 1, 0));
  const push = (itemIndex: number) => {
    for (const src of imagesByItem[itemIndex] ?? []) targets.push({ src, itemIndex });
  };
  for (let i = start; i < imagesByItem.length; i++) push(i);
  for (let i = start - 1; i >= 0; i--) push(i);
  return targets;
}

export function createImagePreloadQueue({
  start,
  concurrency = DEFAULT_CONCURRENCY,
}: {
  // 이미지 한 장 받기를 시작한다. 성공·실패 어느 쪽이든 done()을 불러야 다음 장이
  // 나간다(실패한 장을 다시 시도하지는 않는다 — 다음 장을 받는 게 더 급하다).
  start: (target: PreloadTarget, done: () => void) => void;
  concurrency?: number;
}) {
  // 같은 이미지를 두 번 요청하지 않기 위한 기록. 세트문제(공통지문)는 여러 문항이
  // 같은 이미지 경로를 가리키므로 실제로 자주 겹친다.
  const done = new Set<string>();
  const inFlight = new Set<string>();
  let queue: PreloadTarget[] = [];
  let stopped = false;
  // start가 done을 동기로 부르면(이미 캐시에 있는 경우) pump가 자기 안에서 다시
  // 불리는데, 그때는 바깥 루프가 이어서 다음 장을 꺼내므로 재진입만 막으면 된다.
  let pumping = false;

  function pump() {
    if (pumping) return;
    pumping = true;
    try {
      while (!stopped && inFlight.size < concurrency) {
        const target = queue.shift();
        if (!target) return;
        if (done.has(target.src) || inFlight.has(target.src)) continue;
        inFlight.add(target.src);
        let settled = false;
        start(target, () => {
          if (settled) return;
          settled = true;
          inFlight.delete(target.src);
          done.add(target.src);
          if (!stopped) pump();
        });
      }
    } finally {
      pumping = false;
    }
  }

  return {
    // 지금 보고 있는 문항 기준으로 남은 순서를 다시 매긴다. 이미 받아둔 이미지는
    // 다시 큐에 넣지 않는다.
    prioritize(imagesByItem: string[][], currentIndex: number) {
      if (stopped) return;
      queue = orderPreloadTargets(imagesByItem, currentIndex).filter(
        (t) => !done.has(t.src) && !inFlight.has(t.src),
      );
      pump();
    },
    // 화면을 벗어나면 남은 대기열을 버린다(이미 나간 요청은 브라우저가 알아서 끝낸다).
    stop() {
      stopped = true;
      queue = [];
    },
    pendingCount() {
      return queue.length;
    },
  };
}
