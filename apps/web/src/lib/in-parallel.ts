import "server-only";

// 서로 의존하지 않는 조회를 동시에 돌리되, 동시 실행 수는 제한한다.
//
// 이 코드베이스의 조회는 대부분 "id 목록을 청크로 잘라 여러 번 왕복"하는 형태다.
// 그 청크를 for 루프로 하나씩 기다리면 왕복 지연이 청크 수만큼 그대로 쌓인다.
// 그렇다고 Promise.all 로 전부 한꺼번에 던지면 한 사용자가 커넥션을 독점한다 —
// 무료 티어 DB 라 그 대가를 같은 순간의 다른 사용자가 치른다.
//
// 결과는 입력 순서 그대로 돌려준다(호출부가 인덱스로 되짚을 수 있게).
const QUERY_CONCURRENCY = 8;

export async function inParallel<T, R>(
  items: T[],
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
