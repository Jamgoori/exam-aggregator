// 조회 계층 공용 유틸(웹 lib/wrong-notes.ts 의 inParallel 을 옮긴 것).

// 이 패키지의 조회는 대부분 "id 목록을 청크로 잘라 여러 번 왕복"하는 형태다. 청크를
// for 루프로 하나씩 기다리면 문제지가 많은 과목에서 왕복 지연이 청크 수만큼 그대로
// 쌓인다. 동시에 돌리되, 한 사용자가 커넥션을 독점하지 않도록 동시 실행 수는 제한한다.
export const QUERY_CONCURRENCY = 8;

export async function inParallel<T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  limit = QUERY_CONCURRENCY,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (let i = cursor++; i < items.length; i = cursor++) {
      out[i] = await run(items[i]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return out;
}
