"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionUser } from "@/lib/supabase/session";
import { chatContentError } from "@gongmoa/core";
import { sendChatMessage as sendChatMessageRule } from "@gongmoa/core/server";

// 채팅 서버 액션 — **어댑터**다. 규칙(300자·비속어·도배 간격·반복·연타, 닉네임 확정, insert)은
// packages/core/src/rules/chat.ts 에 있고, Edge Function `chat-send` 가 같은 함수를 부른다. 여기 남은
// 것은 세션 확보뿐이다. 반환 모양·문구는 예전과 같다.

export type ChatMessage = {
  id: string;
  // null = 탈퇴한 회원의 메시지(설계서 §12-2 #17 — 행은 남고 user_id 만 끊긴다). 방금 보낸 메시지는
  // 언제나 로그인 사용자의 것이라 규칙이 돌려주는 값은 문자열이다.
  userId: string | null;
  nickname: string;
  content: string;
  createdAt: string;
};

export type ChatSendResult = { error?: string; message?: ChatMessage };

// 채팅 전송. 비회원은 아예 막는다 — 누가 보냈는지 특정할 수 없으면 도배·비방에 책임을 물을 길이
// 없다(comments 를 회원 전용으로 바꾼 것과 같은 이유).
export async function sendChatMessage(content: string): Promise<ChatSendResult> {
  // 본문 검증은 규칙도 하지만, 로그인 전에 끊던 웹의 순서를 그대로 둔다(문구 동일).
  const contentError = chatContentError(String(content ?? "").trim());
  if (contentError) return { error: contentError };

  const { user } = await getSessionUser();
  if (!user) return { error: "로그인 후 채팅에 참여할 수 있어요." };

  const result = await sendChatMessageRule(createAdminClient(), {
    actor: { userId: user.id, metadataNickname: user.user_metadata?.nickname },
    content,
  });
  if ("error" in result) return { error: result.error };
  return { message: result.message };
}
