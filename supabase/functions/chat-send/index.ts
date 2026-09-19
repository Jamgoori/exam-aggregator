// 채팅 전송(설계서 §6.7 #20). 웹 서버 액션 app/chat/actions.ts#sendChatMessage 와 같은 규칙
// (core rules/chat.ts — 300자·비속어·최소 간격 1.5초·같은 말 반복·10초에 5건)을 부르는 다른 어댑터다.
// chat_messages 는 anon/authenticated 의 insert 가 회수돼 있어(schema.sql) 앱이 표에 직접 쓸 길이 없고,
// 읽기·Realtime 은 public read RLS 라 앱이 supabase-js 로 직접 구독한다(§6.4) — 이 함수는 쓰기만.
//
//   { content }  → { message: { id, userId, nickname, content, createdAt } }
//
// 오류(본문은 `{ error }` 웹 문장 그대로): 401 로그인 필요 · 400 빈 값·길이·비속어 · 429 도배 ·
// 500 저장 실패.
import { corsHeaders, json } from "../_shared/http.ts";
import { coreAdmin, requireUser } from "../_shared/clients.ts";
// @ts-types="../_shared/core.d.ts"
import { sendChatMessage } from "../_shared/core.mjs";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const auth = await requireUser(req);
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body) return json({ error: "잘못된 요청입니다." }, 400);

  // 닉네임은 규칙이 admin API 로 읽는다(세션이 없다).
  const result = await sendChatMessage(coreAdmin(), {
    actor: { userId: auth.userId },
    content: String(body.content ?? ""),
  });
  if ("error" in result) return json({ error: result.error }, result.status);
  return json({ message: result.message });
});
