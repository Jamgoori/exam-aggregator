import type { SupabaseClient } from "@supabase/supabase-js";
import { CHAT_BURST_WINDOW_MS, chatContentError, checkChatBurst, checkChatFlood } from "../chat";
import { authorNickname } from "../nickname";

// 채팅 전송 규칙. 웹 서버 액션(app/chat/actions.ts#sendChatMessage)과 Edge Function `chat-send`
// 가 이 함수의 얇은 어댑터다 — 웹에 있던 본문을 그대로 옮겨 왔고 문구·순서를 새로 짓지 않았다.
// 순수 판정(길이·비속어·도배 간격·연타 횟수)은 ../chat.ts 에 있고, 여기는 그 판정에 넣을 두 조회
// (직전 메시지·최근 창 안의 전송 횟수)와 insert 만 한다.
//
// 쓰기는 항상 service_role 로만 한다: 클라이언트 세션으로 직접 insert 하게 두면 도배 검사를
// 거치지 않는 REST 호출로 우회할 수 있다(schema.sql 이 anon/authenticated 의 insert 권한을 아예
// revoke 해 둔 이유). 읽기·Realtime 은 public read RLS 그대로라 규칙이 필요 없다.

export type ChatActor = {
  userId: string;
  // user_metadata.nickname 원본. 웹은 세션에서 넘기고 Edge 는 생략한다(admin 으로 읽는다).
  metadataNickname?: unknown;
};

// 방금 보낸 메시지. 화면이 목록에 바로 붙이는 값이라 chat_messages 행과 같은 모양이다.
// userId 는 보낸 사람이 언제나 로그인 사용자라 null 이 아니다(탈퇴 뒤 null 이 되는 것은 과거
// 행의 사정 — 웹 chat-panel 의 ChatMessage.userId 가 그 폭을 받는다).
export type ChatSentMessage = {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
};

//   400 빈 값·길이·비속어   429 도배(간격·반복·연타)   500 저장 실패
export type ChatRuleError = { error: string; status: 400 | 429 | 500 };

export type ChatDeps = {
  // 도배 판정의 기준 시각. 테스트가 고정하려고 주입한다.
  now?: () => Date;
};

export async function sendChatMessage(
  client: SupabaseClient,
  input: { actor: ChatActor; content: string },
  deps: ChatDeps = {},
): Promise<ChatRuleError | { message: ChatSentMessage }> {
  const trimmed = String(input.content ?? "").trim();

  const contentError = chatContentError(trimmed);
  if (contentError) return { error: contentError, status: 400 };

  const nowMs = (deps.now ? deps.now() : new Date()).getTime();
  const userId = input.actor.userId;

  // 도배 판정에 필요한 두 조회(직전 메시지, 최근 창 안의 전송 횟수)를 동시에 돌린다.
  const [{ data: last }, { count: recentCount }] = await Promise.all([
    client
      .from("chat_messages")
      .select("content, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("created_at", new Date(nowMs - CHAT_BURST_WINDOW_MS).toISOString()),
  ]);

  const floodCheck = checkChatFlood(
    last
      ? { content: last.content as string, createdAtMs: new Date(last.created_at as string).getTime() }
      : null,
    trimmed,
    nowMs,
  );
  if (!floodCheck.ok) return { error: floodCheck.error, status: 429 };

  const burstCheck = checkChatBurst(recentCount ?? 0);
  if (!burstCheck.ok) return { error: burstCheck.error, status: 429 };

  // 이메일 로컬파트로 떨어지지 않는다 — 닉네임 정책(금칙어 등)을 통과한 적 없는 값이 그대로 공개
  // 채팅에 박히는 사고를 막는다(comments 와 같은 이유).
  const nickname = authorNickname(await resolveNickname(client, input.actor));

  const { data, error } = await client
    .from("chat_messages")
    .insert({ user_id: userId, nickname, content: trimmed })
    .select("id, user_id, nickname, content, created_at")
    .single();

  if (error || !data) return { error: "전송에 실패했어요.", status: 500 };

  return {
    message: {
      id: data.id as string,
      userId: data.user_id as string,
      nickname: data.nickname as string,
      content: data.content as string,
      createdAt: data.created_at as string,
    },
  };
}

// rules/board.ts 와 같은 처리 — 웹은 세션 값을 넘기고 Edge 는 admin 으로 읽는다.
async function resolveNickname(client: SupabaseClient, actor: ChatActor): Promise<unknown> {
  if (actor.metadataNickname !== undefined) return actor.metadataNickname;
  const { data } = await client.auth.admin.getUserById(actor.userId);
  return (data?.user?.user_metadata as { nickname?: unknown } | undefined)?.nickname;
}
