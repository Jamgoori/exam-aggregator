// 계약 테스트용 가짜 Supabase 클라이언트.
//
// 복습 큐의 조회 계층(collectDueCandidates 계열)은 순수 계산이 아니라 여러 테이블을
// 조합하고 정제하는 코드다. 그 정제 규칙(이미지 없는 문항 제외, 삭제 마크 제외,
// 보류 과목 제외, 대표 시험지로 접기)이 깨지면 배너 숫자와 세션 문항이 어긋나는데,
// 순수 함수 테스트로는 절대 안 잡힌다. 그렇다고 로컬 Supabase 스택을 띄우면 문항
// 이미지까지 갖춘 fixture가 필요해 비용이 커진다.
//
// 그래서 PostgREST 빌더의 "이 코드가 실제로 쓰는 부분만" 흉내 낸다:
//   .select(cols, { count, head }) · .eq(임베드 점표기 포함) · .neq · .is · .not(col,"is",null)
//   .gt · .gte · .lt · .lte · .in · .order · .limit · .range · .maybeSingle
//   .update(...)  · storage.from(...).getPublicUrl(...) · .rpc(name, args)
//
// select 문자열은 해석하지 않는다 — 테이블에 넣어 둔 행 객체를 그대로 돌려준다.
// 임베드(exam_papers → subjects, questions → question_images)는 행 안에 중첩
// 객체로 미리 넣어 두면 된다. 컬럼 선택을 흉내 내는 것보다 그게 정직하다:
// 이 테스트가 지키려는 건 "어떤 컬럼을 골랐나"가 아니라 "어떤 문항이 큐에 남나"다.

// PostgREST 의 한 응답 최대 행 수(Supabase 기본값). 이 레포의 대량 조회들이
// range(from, from + 1000 - 1) 로 페이징하는 이유가 이 값이다.
const MAX_ROWS = 1000;

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

export type WriteLog = {
  table: string;
  values: Row;
  // 어떤 행이 대상이었는지 — 승격 쓰기가 맞는 행을 골랐는지 확인하는 데 쓴다.
  matched: Row[];
};

// PromiseLike 를 명시적으로 구현하지는 않는다 — maybeSingle() 이 다른 모양을
// 돌려주므로 한 시그니처로 못 묶는다. await 가 then 을 찾기만 하면 된다.
class Query {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private wantCount = false;
  private headOnly = false;
  private updateValues: Row | null = null;
  private single = false;

  constructor(
    private readonly table: string,
    private readonly db: FakeSupabase,
  ) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  update(values: Row): this {
    this.updateValues = values;
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push((r) => valueAt(r, column) === value);
    return this;
  }

  neq(column: string, value: unknown): this {
    this.filters.push((r) => r[column] !== value);
    return this;
  }

  // .is(col, null) — PostgREST 의 null 비교.
  is(column: string, value: null): this {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }

  // .not(col, "is", null) — "null 이 아닌 것".
  not(column: string, op: string, value: unknown): this {
    if (op !== "is" || value !== null) throw new Error(`not(${op}) 는 흉내 내지 않는다`);
    this.filters.push((r) => (r[column] ?? null) !== null);
    return this;
  }

  gt(column: string, value: number): this {
    this.filters.push((r) => Number(r[column] ?? 0) > value);
    return this;
  }

  gte(column: string, value: string | number): this {
    this.filters.push((r) => compare(r[column], value) >= 0);
    return this;
  }

  lt(column: string, value: string | number): this {
    this.filters.push((r) => compare(r[column], value) < 0);
    return this;
  }

  lte(column: string, value: string | number): this {
    this.filters.push((r) => compare(r[column], value) <= 0);
    return this;
  }

  in(column: string, values: unknown[]): this {
    const set = new Set(values);
    this.filters.push((r) => set.has(r[column]));
    return this;
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.orders.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.limitCount = n;
    return this;
  }

  range(from: number, to: number): this {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  maybeSingle(): PromiseLike<{ data: Row | null; error: null }> {
    this.single = true;
    return this as unknown as PromiseLike<{ data: Row | null; error: null }>;
  }

  private rows(): Row[] {
    const all = this.db.tables[this.table] ?? [];
    let out = all.filter((r) => this.filters.every((f) => f(r)));
    for (const { column, ascending } of [...this.orders].reverse()) {
      out = [...out].sort(
        (a, b) => compare(a[column], b[column] as string | number) * (ascending ? 1 : -1),
      );
    }
    return out;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(onfulfilled?: (value: any) => any, onrejected?: (reason: unknown) => unknown): any {
    let result: unknown;
    try {
      const matched = this.rows();

      if (this.updateValues) {
        for (const row of matched) Object.assign(row, this.updateValues);
        this.db.writes.push({ table: this.table, values: this.updateValues, matched });
        result = { data: null, error: null };
      } else {
        this.db.reads.push(this.table);
        let page = matched;
        if (this.rangeTo != null) page = page.slice(this.rangeFrom, this.rangeTo + 1);
        if (this.limitCount != null) page = page.slice(0, this.limitCount);
        // PostgREST 는 한 응답에 최대 MAX_ROWS 행만 실어 보낸다(Supabase 기본값).
        // 넘치면 조용히 잘릴 뿐 에러가 아니라서, 페이징을 빠뜨린 조회는 운영에서만
        // 틀린 답을 낸다 — 실제로 그렇게 난 사고가 있어(dedup 문항 수) 가짜 쪽도
        // 같은 자름을 흉내 낸다. 대량 조회를 하는 코드는 .range 로 끝까지 훑어야 한다.
        if (page.length > MAX_ROWS) page = page.slice(0, MAX_ROWS);

        result = this.single
          ? { data: page[0] ?? null, error: null }
          : {
              data: this.headOnly ? null : page,
              error: null,
              count: this.wantCount ? matched.length : null,
            };
      }
    } catch (e) {
      return Promise.reject(e).then(onfulfilled, onrejected);
    }
    return Promise.resolve(result).then(onfulfilled, onrejected);
  }
}

// PostgREST 의 임베드 필터(`exam_papers.subject_id=eq.X`)를 흉내 낸다. 점이 있으면
// 중첩 객체를 따라 내려간다 — 임베드가 배열이면 한 항목이라도 맞으면 통과시키는
// 대신 첫 항목만 본다(이 레포의 임베드는 전부 1:1 이다).
function valueAt(row: Row, column: string): unknown {
  if (!column.includes(".")) return row[column];
  let cur: unknown = row;
  for (const part of column.split(".")) {
    if (cur == null) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Row)[part];
  }
  return cur;
}

function compare(a: unknown, b: string | number | unknown): number {
  const x = a ?? "";
  const y = (b ?? "") as string | number;
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

export class FakeSupabase {
  readonly writes: WriteLog[] = [];
  readonly reads: string[] = [];

  constructor(public tables: Tables) {}

  from(table: string): Query {
    return new Query(table, this);
  }

  // RPC 는 SQL 을 흉내 내지 않는다. 테스트가 이름별 구현을 직접 꽂고, 꽂지 않은
  // 이름은 "이 환경에 그 함수가 없다"로 취급해 에러를 돌려준다 — 마이그레이션 전
  // 환경에서 호출부가 대체 경로로 떨어지는지 확인하는 데 그 모양이 필요하다.
  rpcHandlers: Record<string, (args: Row) => Row[]> = {};

  rpc(name: string, args: Row = {}): Promise<{ data: Row[] | null; error: unknown }> {
    this.reads.push(`rpc:${name}`);
    const handler = this.rpcHandlers[name];
    if (!handler) {
      return Promise.resolve({
        data: null,
        error: { code: "PGRST202", message: `function ${name} does not exist` },
      });
    }
    return Promise.resolve({ data: handler(args), error: null });
  }

  storage = {
    from: () => ({
      // 실제 URL 형태는 이 테스트가 검증하려는 대상이 아니다. 경로를 그대로 돌려주면
      // "이미지가 있다/없다"만 갈린다.
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
    }),
  };
}

// apps/web 의 조회 함수들이 받는 타입은 Supabase 클라이언트지만, 실제로 쓰는 표면은
// 위가 전부다. 테스트에서만 캐스팅한다.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function asSupabase(fake: FakeSupabase): any {
  return fake;
}
