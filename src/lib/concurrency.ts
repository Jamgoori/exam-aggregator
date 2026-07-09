// 여러 항목을 limit개씩 동시에 처리하는 간단한 워커 풀. scripts/*.mjs의
// runPool과 같은 패턴의 TS 버전(스크립트는 .mjs라 경로 별칭으로 공유할 수 없어
// 따로 둔다).
export async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function runNext() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runNext()));
  return results;
}
