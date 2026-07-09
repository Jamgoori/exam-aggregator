// PostgREST(Supabase)는 range()를 안 주면 한 번에 최대 1000행까지만 돌려준다
// (db.max_rows). 이 한도에 걸리면 1000행 뒤는 조용히 잘려서, 대상이 실제로는
// 1000개보다 많은데도 "1000개"로 보이는 채로 마이그레이션이 끝나버린다.
// queryFn은 호출할 때마다 새 쿼리 빌더를 돌려줘야 한다(같은 빌더에 range를 두 번
// 걸 수 없어서) — range만 바꿔가며 끝까지 이어받는다.
const BATCH_SIZE = 1000;

export async function fetchAllRows(queryFn) {
  const rows = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn().range(from, from + BATCH_SIZE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < BATCH_SIZE) break;
    from += BATCH_SIZE;
  }
  return rows;
}
