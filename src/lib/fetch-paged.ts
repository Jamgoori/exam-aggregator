import "server-only";

// PostgREST는 range()를 안 주면 한 번에 최대 1000행까지만 돌려준다(db.max_rows).
// 그래서 "전체"를 받아야 하는 조회는 1000건씩 이어받아야 하는데, 이걸 while 루프로
// 한 장씩 순차 요청하면 왕복 지연이 그대로 쌓인다(문제지 3383건 = 4왕복, 실측 약 2초).
// 어차피 페이지끼리는 서로 의존하지 않으므로 한 묶음씩 동시에 요청한다.
const BATCH_SIZE = 1000;
// 한 번에 던지는 페이지 수. 현재 데이터(문제지 3383건)면 한 묶음으로 끝난다.
// 무료 티어 DB라 동시 요청을 무작정 늘리지는 않는다.
const CONCURRENCY = 4;

export type PagedResult<T> = { data: T[] | null; error: { message: string } | null };

// fetchRange(from, to)를 병렬로 여러 번 불러 전체 행을 모은다.
//
// 조회 실패는 삼키지 않고 던진다 — 예전에 에러/한도에 걸린 페이지를 조용히 건너뛰는
// 바람에 목록이 잘린 채로 "총 1000개의 자료"처럼 멀쩡해 보였던 사고가 있었다.
// 부분 목록을 정답인 척 보여주느니 화면에 실패를 드러내는 편이 낫다.
export async function fetchAllPages<T>(
  fetchRange: (from: number, to: number) => Promise<PagedResult<T>>,
  label: string,
): Promise<T[]> {
  const all: T[] = [];
  let start = 0;

  while (true) {
    const wave = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) => {
        const from = start + i * BATCH_SIZE;
        return fetchRange(from, from + BATCH_SIZE - 1);
      }),
    );

    for (const { data, error } of wave) {
      if (error) throw new Error(`${label} 조회 실패: ${error.message}`);
      const page = data ?? [];
      all.push(...page);
      // 한 페이지라도 꽉 차지 않으면 거기가 끝이다 — 같은 묶음의 뒤쪽 페이지는
      // 어차피 빈 결과이므로 버려도 된다.
      if (page.length < BATCH_SIZE) return all;
    }

    start += CONCURRENCY * BATCH_SIZE;
  }
}
