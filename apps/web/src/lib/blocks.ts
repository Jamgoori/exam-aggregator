import "server-only";
import { getSessionUser } from "@/lib/supabase/session";

// 사용자 차단 — 웹 쪽 읽기(설계서 §12-2 #16, 앱 queries/board.ts 의 useBlockedIds·useBlockedUsers 와
// 같은 두 조회). 차단은 **내가 보는 화면**에서 상대의 글·댓글·메시지가 사라지는 것이고 상대는
// 모른다. 그래서 서버 RLS 는 건드리지 않고(user_blocks 는 "select own" 뿐), 뷰어의 차단 집합을
// 세션으로 읽어 서버 컴포넌트가 목록을 거른다(lib/board.ts). 차단 목록 자체는 클라이언트에
// 내려보내지 않는다 — 채팅만 예외로 브라우저가 같은 표를 직접 읽는다(Realtime 수신을 거르려면
// 브라우저에 집합이 있어야 한다, components/chat-panel.tsx).
//
// 쓰기(block_user·unblock_user·report_content)는 전부 SD RPC 고 app/board/actions.ts 가 부른다.

// 조회에 필요한 최소 모양. 세션 SupabaseClient 가 그대로 들어맞고, 테스트는 가짜를 넣는다.
export type BlockedRowsReader = {
  from(table: "user_blocks"): {
    select(columns: "blocked_id"): PromiseLike<{ data: unknown; error: unknown }>;
  };
};

// 조회 결과 → id 집합. 행 모양이 어긋나거나(다른 컬럼) 오류가 왔으면 **빈 집합**이다 — 차단 필터가
// 실패했다고 게시판 전체를 막을 이유는 없다(앱도 조회가 실패하면 빈 집합으로 그린다). 특히
// Phase 5 1라운드 SQL 이 운영 DB 에 아직 적용되지 않아 user_blocks 표가 없을 수 있다 — 그때도
// 게시판은 그대로 열려야 한다.
export function blockedIdSet(data: unknown, error: unknown): ReadonlySet<string> {
  if (error || !Array.isArray(data)) return new Set();
  const ids = new Set<string>();
  for (const row of data) {
    const id = (row as { blocked_id?: unknown } | null)?.blocked_id;
    if (typeof id === "string" && id) ids.add(id);
  }
  return ids;
}

// 비로그인은 조회 없이 빈 집합 — RLS 가 어차피 0행을 주지만 왕복 하나를 아낀다.
export async function fetchBlockedIdsWith(
  reader: BlockedRowsReader,
  userId: string | null,
): Promise<ReadonlySet<string>> {
  if (!userId) return new Set();
  const { data, error } = await reader.from("user_blocks").select("blocked_id");
  return blockedIdSet(data, error);
}

// 세션 사용자의 차단 집합. 서버 컴포넌트·lib 조회에서 부른다.
export async function fetchBlockedIds(): Promise<ReadonlySet<string>> {
  const { supabase, user } = await getSessionUser();
  return fetchBlockedIdsWith(supabase, user?.id ?? null);
}

// PostgREST 가 내려주는 RPC 오류 중 RPC 본문의 raise exception(P0001)만 사람 말이다(schema.sql
// 의 SD 함수가 웹 서버 액션과 같은 문장을 던진다). 그 밖(함수 미적용 PGRST202·권한 42501·
// 네트워크)은 SQL 문구라 한 문장으로 덮는다 — 앱 queries/board.ts#rpcErrorMessage 와 같은 규칙.
const RAISE_EXCEPTION = "P0001";

export function rpcErrorMessage(
  error: { code?: string; message?: string } | null | undefined,
  fallback: string,
): string {
  return error?.code === RAISE_EXCEPTION && error.message ? error.message : fallback;
}

// 내 정보 수정의 "차단한 사용자" 절이 그리는 목록. 닉네임은 SD RPC my_blocked_users 가 profiles
// 에서 붙인다(user_blocks 에는 id 뿐이고 profiles 는 본인 행만 보이는 RLS). 매번 서버에서 읽는다 —
// 차단 시점의 닉네임을 저장해 두면 바뀐 뒤 낡은 이름이 남는다(앱 blocked-users-section.tsx).
export type BlockedUser = { userId: string; nickname: string; createdAt: string };

export async function fetchBlockedUsers(): Promise<{ users: BlockedUser[]; error: string | null }> {
  const { supabase, user } = await getSessionUser();
  if (!user) return { users: [], error: null };

  const { data, error } = await supabase.rpc("my_blocked_users");
  if (error) return { users: [], error: rpcErrorMessage(error, "차단 목록을 불러오지 못했어요.") };

  const rows = (data ?? []) as { user_id: string; nickname: string; created_at: string }[];
  return {
    users: rows.map((row) => ({ userId: row.user_id, nickname: row.nickname, createdAt: row.created_at })),
    error: null,
  };
}
