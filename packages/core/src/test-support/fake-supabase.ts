// rules/* 계약 테스트용 가짜 Supabase 클라이언트.
//
// rules/* 는 순수 계산이 아니라 여러 테이블을 읽고 쓰는 코드다. "시작 행을 회수한 요청만
// 채점한다", "대기 풀 오답은 srs_due_at 을 심지 않는다" 같은 규칙은 순수 함수 테스트로는
// 절대 안 잡히고, 로컬 Supabase 스택을 띄우면 fixture 비용이 크다. 그래서 PostgREST
// 빌더의 "이 코드가 실제로 쓰는 부분만" 흉내 낸다(웹 apps/web/src/lib/test-support/
// fake-supabase.ts 와 같은 발상 — 여기에는 쓰기(insert/upsert/delete)와 rpc 가 더 있다):
//   .select(cols, { count, head }) · .eq · .neq · .is · .not(col,"is",null)
//   .gt · .gte · .lt · .lte · .in · .order · .limit · .range · .maybeSingle · .single
//   .insert(row|rows) · .upsert(row|rows, { onConflict }) · .update(values) · .delete()
//   쓰기 뒤 .select(cols) 는 영향받은 행을 돌려준다(returning).
//   insert 가 기본키/onConflict 로 겹치면 { error: { code: "23505" } } (PostgREST 와 같은 모양).
//   .rpc(name, args) 는 생성자에 넘긴 핸들러가 처리한다.
//   storage.from(bucket).getPublicUrl / .upload / .remove — 호출을 uploads·removes 에 기록.
//   storage.from(bucket).list(prefix, { limit }) — objects[bucket] 에 심어 둔 객체 중 `${prefix}/`
//     아래 것을 { name, created_at } 로 돌려준다(rules/board.ts 의 이미지 시간당 한도).
//   auth.admin.getUserById / .updateUserById — users 테이블의 user_metadata 를 병합.
//   auth.admin.deleteUser — users 에서 행을 빼고 deletedUsers 에 기록(rules/account-delete.ts).
//   storage.from(bucket).list 는 failNextStorageList 로 한 번 실패시킬 수 있다.
//
// select 문자열은 해석하지 않는다 — 테이블에 넣어 둔 행 객체를 그대로 돌려준다.
// 임베드(questions → question_images)는 행 안에 중첩 객체로 미리 넣어 두면 된다.

import type { SupabaseClient } from "@supabase/supabase-js";

export type Row = Record<string, unknown>;
export type Tables = Record<string, Row[]>;

type Filter = (row: Row) => boolean;

export type WriteLog = {
  table: string;
  op: "insert" | "upsert" | "update" | "delete";
  values: Row[];
  matched: Row[];
};

export type RpcLog = { name: string; args: Row };
export type StorageOpLog = { bucket: string; paths: string[] };

type RpcHandler = (args: Row, db: FakeSupabase) => unknown;

let idSeq = 0;

class Query {
  private filters: Filter[] = [];
  private orders: { column: string; ascending: boolean }[] = [];
  private limitCount: number | null = null;
  private rangeFrom = 0;
  private rangeTo: number | null = null;
  private wantCount = false;
  private headOnly = false;
  private singleMode: "maybe" | "strict" | null = null;
  private write:
    | { op: "insert" | "upsert"; rows: Row[]; onConflict: string[] | null }
    | { op: "update"; values: Row }
    | { op: "delete" }
    | null = null;
  private returning = false;

  constructor(
    private readonly table: string,
    private readonly db: FakeSupabase,
  ) {}

  select(_columns?: string, opts?: { count?: string; head?: boolean }): this {
    if (this.write) this.returning = true;
    if (opts?.count) this.wantCount = true;
    if (opts?.head) this.headOnly = true;
    return this;
  }

  insert(values: Row | Row[]): this {
    this.write = { op: "insert", rows: Array.isArray(values) ? values : [values], onConflict: null };
    return this;
  }

  upsert(values: Row | Row[], opts?: { onConflict?: string }): this {
    this.write = {
      op: "upsert",
      rows: Array.isArray(values) ? values : [values],
      onConflict: opts?.onConflict ? opts.onConflict.split(",").map((s) => s.trim()) : null,
    };
    return this;
  }

  update(values: Row): this {
    this.write = { op: "update", values };
    return this;
  }

  delete(): this {
    this.write = { op: "delete" };
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

  is(column: string, value: null): this {
    this.filters.push((r) => (r[column] ?? null) === value);
    return this;
  }

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

  maybeSingle(): this {
    this.singleMode = "maybe";
    return this;
  }

  single(): this {
    this.singleMode = "strict";
    return this;
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

  private ensureTable(): Row[] {
    return (this.db.tables[this.table] ??= []);
  }

  private applyWrite(): Row[] {
    const w = this.write!;
    if (w.op === "delete") {
      const matched = this.rows();
      const table = this.ensureTable();
      for (const row of matched) table.splice(table.indexOf(row), 1);
      this.db.writes.push({ table: this.table, op: "delete", values: [], matched });
      return matched;
    }
    if (w.op === "update") {
      const matched = this.rows();
      for (const row of matched) Object.assign(row, w.values);
      this.db.writes.push({ table: this.table, op: "update", values: [w.values], matched });
      return matched;
    }
    const table = this.ensureTable();
    const affected: Row[] = [];
    for (const incoming of w.rows) {
      const row = { ...incoming };
      const keyCols = w.onConflict ?? this.db.primaryKeys[this.table] ?? null;
      const existing =
        keyCols && keyCols.every((c) => c in row)
          ? table.find((r) => keyCols.every((c) => r[c] === row[c]))
          : undefined;
      if (existing) {
        if (w.op === "insert") {
          throw Object.assign(new Error(`duplicate key on ${this.table}`), { code: "23505" });
        }
        Object.assign(existing, row);
        affected.push(existing);
        continue;
      }
      if (!("id" in row)) row.id = `${this.table}-${++idSeq}`;
      table.push(row);
      affected.push(row);
    }
    this.db.writes.push({ table: this.table, op: w.op, values: w.rows, matched: affected });
    return affected;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  then(onfulfilled?: (value: any) => any, onrejected?: (reason: unknown) => unknown): any {
    let result: unknown;
    try {
      const failure = this.db.failNext.get(this.table);
      if (failure) {
        this.db.failNext.delete(this.table);
        result = { data: null, error: { message: failure }, count: null };
      } else if (this.write) {
        const affected = this.applyWrite();
        if (this.returning) {
          result = this.singleMode
            ? { data: affected[0] ?? null, error: null }
            : { data: affected, error: null };
        } else {
          result = { data: null, error: null };
        }
      } else {
        this.db.reads.push(this.table);
        const matched = this.rows();
        let page = matched;
        if (this.rangeTo != null) page = page.slice(this.rangeFrom, this.rangeTo + 1);
        if (this.limitCount != null) page = page.slice(0, this.limitCount);

        // 읽은 행은 **사본**으로 돌려준다. PostgREST 는 JSON 을 새로 만들어 주므로
        // "먼저 읽어 둔 값"은 그 뒤의 update 로 바뀌지 않는데, 저장한 객체를 그대로
        // 내주면 여기서만 같이 바뀐다 — rules/avatar.ts 의 "예전 경로를 기억해 뒀다가
        // 맨 뒤에 그 객체를 지운다" 같은 규칙이 테스트에서 조용히 통과해 버린다.
        const detach = (r: Row) => ({ ...r });
        result = this.singleMode
          ? { data: page[0] ? detach(page[0]) : null, error: null }
          : {
              data: this.headOnly ? null : page.map(detach),
              error: null,
              count: this.wantCount ? matched.length : null,
            };
      }
    } catch (e) {
      // 유니크 충돌(insert 중복)은 PostgREST 처럼 { error: { code: "23505" } } 로 돌려준다 —
      // rules/review-session.ts 의 requestId 멱등 경로가 이 코드를 보고 기존 세션을 찾는다.
      const code = (e as { code?: string })?.code;
      if (code) {
        result = { data: null, error: { message: String((e as Error).message), code }, count: null };
        return Promise.resolve(result).then(onfulfilled, onrejected);
      }
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
  readonly rpcs: RpcLog[] = [];
  // 다음 한 번의 접근에서 그 테이블이 error 를 돌려주게 한다(실패 경로 테스트).
  readonly failNext = new Map<string, string>();

  constructor(
    public tables: Tables,
    private readonly opts: {
      // upsert 의 onConflict 가 없을 때·insert 중복 판정에 쓰는 기본키.
      primaryKeys?: Record<string, string[]>;
      rpc?: Record<string, RpcHandler>;
    } = {},
  ) {}

  get primaryKeys(): Record<string, string[]> {
    return this.opts.primaryKeys ?? {};
  }

  from(table: string): Query {
    return new Query(table, this);
  }

  async rpc(name: string, args: Row = {}): Promise<{ data: unknown; error: null | { message: string } }> {
    this.rpcs.push({ name, args });
    const handler = this.opts.rpc?.[name];
    if (!handler) return { data: null, error: null };
    try {
      return { data: await handler(args, this), error: null };
    } catch (e) {
      return { data: null, error: { message: String(e) } };
    }
  }

  // 스토리지에 올리고 지운 흔적. rules/avatar.ts 처럼 "업로드 → DB → 예전 것 삭제" 순서가
  // 곧 규칙인 코드는 **순서와 대상**을 봐야 해서, 호출을 기록만 하고 성공을 돌려준다.
  readonly uploads: StorageOpLog[] = [];
  readonly removes: StorageOpLog[] = [];
  // 다음 한 번의 upload 를 실패시킨다(버킷 없음 분기 등).
  failNextUpload: string | null = null;
  // 다음 한 번의 list 를 실패시킨다(탈퇴 스토리지 정리의 "실패는 로그만" 분기).
  failNextStorageList: string | null = null;
  // auth.admin.deleteUser 로 지운 사용자 id(호출 순서대로). 다음 한 번을 실패시키려면 failNextDeleteUser.
  readonly deletedUsers: string[] = [];
  failNextDeleteUser: string | null = null;

  // 버킷 안에 "이미 있는" 객체. list 가 읽고 upload 가 덧붙인다 — rules/board.ts 의 이미지
  // 시간당 한도가 표가 아니라 스토리지 목록을 세기 때문에 필요하다. created_at 은 ISO 문자열.
  readonly objects: Record<string, { path: string; created_at: string }[]> = {};

  storage = {
    from: (bucket = "exam-papers") => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.test/${path}` } }),
      upload: async (path: string, _body: unknown, _opts?: unknown) => {
        const message = this.failNextUpload;
        this.failNextUpload = null;
        if (message) return { data: null, error: { message } };
        this.uploads.push({ bucket, paths: [path] });
        (this.objects[bucket] ??= []).push({ path, created_at: new Date().toISOString() });
        return { data: { path }, error: null };
      },
      list: async (prefix: string, opts?: { limit?: number }) => {
        const message = this.failNextStorageList;
        this.failNextStorageList = null;
        if (message) return { data: null, error: { message } };
        const head = `${prefix}/`;
        const rows = (this.objects[bucket] ?? [])
          .filter((o) => o.path.startsWith(head))
          .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
          .slice(0, opts?.limit ?? 100)
          .map((o) => ({ name: o.path.slice(head.length), created_at: o.created_at }));
        return { data: rows, error: null };
      },
      remove: async (paths: string[]) => {
        this.removes.push({ bucket, paths });
        // 지운 객체는 목록에서도 빠진다 — 탈퇴 정리가 "빌 때까지" 첫 장을 다시 읽으므로 안 빼면 무한 루프다.
        const set = new Set(paths);
        if (this.objects[bucket]) {
          this.objects[bucket] = this.objects[bucket].filter((o) => !set.has(o.path));
        }
        return { data: paths.map((p) => ({ name: p })), error: null };
      },
    }),
  };

  // auth.admin 은 service_role 규칙이 user_metadata 를 고칠 때만 쓴다(닉네임·아바타 경로).
  // 저장소는 users 테이블 하나로 흉내 내고, 병합은 실제와 같게 top-level 키 단위다.
  auth = {
    admin: {
      getUserById: async (id: string) => {
        const row = (this.tables.users ?? []).find((u) => u.id === id);
        return { data: { user: row ? { id, user_metadata: row.user_metadata ?? {} } : null }, error: null };
      },
      updateUserById: async (id: string, attrs: { user_metadata?: Row }) => {
        const row = (this.tables.users ??= []).find((u) => u.id === id) ?? this.addUser(id);
        row.user_metadata = { ...((row.user_metadata as Row) ?? {}), ...(attrs.user_metadata ?? {}) };
        return { data: { user: { id, user_metadata: row.user_metadata } }, error: null };
      },
      deleteUser: async (id: string) => {
        const message = this.failNextDeleteUser;
        this.failNextDeleteUser = null;
        if (message) return { data: { user: null }, error: { message } };
        const users = this.tables.users ?? [];
        const idx = users.findIndex((u) => u.id === id);
        if (idx >= 0) users.splice(idx, 1);
        this.deletedUsers.push(id);
        return { data: { user: null }, error: null };
      },
    },
  };

  private addUser(id: string): Row {
    const row: Row = { id, user_metadata: {} };
    (this.tables.users ??= []).push(row);
    return row;
  }

  rowsOf(table: string): Row[] {
    return this.tables[table] ?? [];
  }
}

// rules/* 가 받는 타입은 SupabaseClient 지만 실제로 쓰는 표면은 위가 전부다.
// 테스트에서만 캐스팅한다.
export function asClient(fake: FakeSupabase): SupabaseClient {
  return fake as unknown as SupabaseClient;
}
