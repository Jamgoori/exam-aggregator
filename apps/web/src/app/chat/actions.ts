"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import {
  authorNickname,
  CHAT_BURST_WINDOW_MS,
  CHAT_CONTENT_MAX,
  checkChatBurst,
  checkChatFlood,
  profanityError,
} from "@gongmoa/core";

export type ChatMessage = {
  id: string;
  userId: string;
  nickname: string;
  content: string;
  createdAt: string;
};

export type ChatSendResult = { error?: string; message?: ChatMessage };

function validateContent(content: string): string | null {
  if (!content) return "메시지를 입력해주세요.";
  if (content.length > CHAT_CONTENT_MAX) {
    return `메시지는 ${CHAT_CONTENT_MAX}자 이하로 입력해주세요.`;
  }
  return profanityError(content);
}

// 채팅 전송. 비회원은 아예 막는다 — 누가 보냈는지 특정할 수 없으면 도배·비방에
// 책임을 물을 길이 없다(comments 를 회원 전용으로 바꾼 것과 같은 이유).
//
// 쓰기는 항상 service_role 로만 한다: 클라이언트 세션으로 직접 insert 하게 두면
// 아래 도배 검사를 거치지 않는 REST 호출로 우회할 수 있다(schema.sql 이 anon/
// authenticated 의 insert 권한을 아예 revoke 해 둔 이유이기도 하다).
export async function sendChatMessage(content: string): Promise<ChatSendResult> {
  const trimmed = String(content ?? "").trim();

  const contentError = validateContent(trimmed);
  if (contentError) return { error: contentError };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 채팅에 참여할 수 있어요." };

  const admin = createAdminClient();

  // 도배 판정에 필요한 두 조회(직전 메시지, 최근 창 안의 전송 횟수)를 동시에 돌린다.
  const [{ data: last }, { count: recentCount }] = await Promise.all([
    admin
      .from("chat_messages")
      .select("content, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", new Date(Date.now() - CHAT_BURST_WINDOW_MS).toISOString()),
  ]);

  const floodCheck = checkChatFlood(
    last
      ? { content: last.content as string, createdAtMs: new Date(last.created_at as string).getTime() }
      : null,
    trimmed,
    Date.now(),
  );
  if (!floodCheck.ok) return { error: floodCheck.error };

  const burstCheck = checkChatBurst(recentCount ?? 0);
  if (!burstCheck.ok) return { error: burstCheck.error };

  // 이메일 로컬파트로 떨어지지 않는다 — 닉네임 정책(금칙어 등)을 통과한 적 없는
  // 값이 그대로 공개 채팅에 박히는 사고를 막는다(comments 와 같은 이유).
  const nickname = authorNickname(user.user_metadata?.nickname);

  const { data, error } = await admin
    .from("chat_messages")
    .insert({ user_id: user.id, nickname, content: trimmed })
    .select("id, user_id, nickname, content, created_at")
    .single();

  if (error || !data) return { error: "전송에 실패했어요." };

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
