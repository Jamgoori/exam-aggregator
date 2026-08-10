// 계약 테스트용 가짜 Supabase 클라이언트.
//
// 복습 큐의 조회 계층(collectDueCandidates 계열)은 순수 계산이 아니라 여러 테이블을
// 조합하고 정제하는 코드다. 그 정제 규칙(이미지 없는 문항 제외, 삭제 마크 제외,
// 보류 과목 제외, 대표 시험지로 접기)이 깨지면 배너 숫자와 세션 문항이 어긋나는데,
// 순수 함수 테스트로는 절대 안 잡힌다. 그렇다고 로컬 Supabase 스택을 띄우면 문항
// 이미지까지 갖춘 fixture가 필요해 비용이 커진다.
//
// 그래서 PostgREST 빌더의 "이 코드가 실제로 쓰는 부분만" 흉내 낸다:
//   .select(cols, { count, head }) · .eq · .neq · .is · .not(col,"is",null)
//   .gt · .gte · .lt · .lte · .in · .order · .limit · .range · .maybeSingle
//   .update(...)  · storage.from(...).getPublicUrl(...)
//
// select 문자열은 해석하지 않는다 — 테이블에 넣어 둔 행 객체를 그대로 돌려준다.
// 임베드(exam_papers → subjects, questions → question_images)는 행 안에 중첩
// 객체로 미리 넣어 두면 된다. 컬럼 선택을 흉내 내는 것보다 그게 정직하다:
// 이 테스트가 지키려는 건 "어떤 컬럼을 골랐나"가 아니라 "어떤 문항이 큐에 남나"다.

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
    this.filters.push((r) => r[column] === value);
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
