import { filterBlocked, isEdgeError, type ChatSendResponse } from "@gongmoa/core";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useBlockedIds } from "./board";
import { callEdge, handleEdgeError } from "../lib/edge";
import { subscribeRowChanges } from "../lib/realtime";
import { supabase } from "../lib/supabase";

// 채팅 이력·실시간·전송·신고 — 웹 components/chat-panel.tsx(이력·구독·전송 순서)와 app/chat/actions.ts
// (전송 규칙은 core rules/chat.ts, 앱은 EF chat-send 를 부른다)의 앱 판(설계서 §6.2 채팅 행, §6.4, §6.7 #20).
//
// 읽기는 public read RLS 라 앱 세션(anon 키)으로 그대로 읽고 Realtime 도 같은 키로 구독한다. 쓰기는 EF
// chat-send 뿐 — chat_messages 의 insert 는 클라이언트에서 회수돼 있어(schema.sql) 도배 검사를 우회할 길이
// 없다(금지선). 신고는 게시판·건의글과 같은 queries/ugc.ts useReportContent(SD RPC report_content —
// 'chat_message')를 신고 시트(board-report-sheet.tsx)가 부르고, 차단은 queries/board.ts 의 useBlockUser 를
// 그대로 쓴다(차단 집합은 게시판과 같은 ['me', uid, 'blocks']).
//
// ── 캐시 ────────────────────────────────────────────────────────────────────
// 이력은 TanStack Query 에 넣지 않고 React state 로 든다(웹과 같다). 채팅은 관리자가 언제든 지울 수 있는
// 기록이라 디스크에 남기지 않고, 패널을 닫으면 버린다 — 다시 열 때 최근 CHAT_HISTORY_LIMIT 개를 새로 읽는
// 것이 "지워진 메시지가 남아 있지 않다"는 보증이다. 메모리 상한은 CHAT_BUFFER_MAX.

// 화면에 한 번에 보여줄 최근 메시지 수 — 웹 chat-panel.tsx HISTORY_LIMIT 과 같은 값(메시지당 최대 300자라
// 300개를 받아도 수백 KB 수준).
export const CHAT_HISTORY_LIMIT = 300;

// 이력 + 실시간 누적의 메모리 상한. 웹은 페이지를 떠나면 사라지므로 상한이 없지만 앱은 패널을 열어 둔 채
// 오래 두는 일이 흔하다(대화방을 띄워 놓고 다른 일을 함). 300자 × 600건 ≈ 180KB 텍스트 + 객체 오버헤드라
// 저사양 기기에서도 문제없는 크기이고, 이력 한 번(300)에 실시간으로 그만큼 더 쌓이면 가장 오래된 것부터
// 버린다 — 위로 올려 옛 대화를 읽는 사람은 어차피 이력 300개 안에서 읽는다.
export const CHAT_BUFFER_MAX = CHAT_HISTORY_LIMIT * 2;

// 웹 app/chat/actions.ts ChatMessage 와 같은 모양. userId null = 탈퇴한 회원의 메시지(설계서 §12-2 #17 —
// 행은 남고 user_id 만 끊긴다). "내 메시지" 판정은 반드시 `userId !== null &&` 로(null === null 방지).
export type ChatMessage = {
  id: string;
  userId: string | null;
  nickname: string;
  content: string;
  createdAt: string;
};

// chat_messages 행(이력 select 와 Realtime INSERT 페이로드가 같은 컬럼).
export type ChatMessageRow = {
  id: string;
  user_id: string | null;
  nickname: string;
  content: string;
  created_at: string;
};

export function rowToMessage(row: ChatMessageRow): ChatMessage {
  return {
    id: row.id,
    userId: row.user_id,
    nickname: row.nickname,
    content: row.content,
    createdAt: row.created_at,
  };
}

function capBuffer(list: ChatMessage[]): ChatMessage[] {
  return list.length > CHAT_BUFFER_MAX ? list.slice(list.length - CHAT_BUFFER_MAX) : list;
}

// 이미 있는 id면 그대로 두고, 없으면 뒤에 붙인다(웹 appendUnique). 본인이 보낸 메시지는 EF 응답으로 먼저
// 그려지고, 잠시 뒤 실시간 구독으로 같은 메시지가 한 번 더 들어오므로 중복을 막아야 한다.
export function appendUnique(prev: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === message.id)) return prev;
  return capBuffer([...prev, message]);
}

// 이력을 다시 읽었을 때(포그라운드 복귀) 합치는 규칙. 서버가 돌려준 최근 목록이 정본이다 — 백그라운드에서
// 놓친 메시지가 들어오고, 그 사이 관리자가 지운 메시지는 빠진다. 다만 구독을 먼저 걸고 이력을 읽으므로
// 조회 중에 실시간으로 붙은(이력 응답보다 새로운) 메시지는 잃지 않게 뒤에 남긴다.
export function mergeHistory(prev: ChatMessage[] | null, rows: ChatMessage[]): ChatMessage[] {
  if (!prev || prev.length === 0 || rows.length === 0) return rows;
  const known = new Set(rows.map((r) => r.id));
  const lastMs = new Date(rows[rows.length - 1].createdAt).getTime();
  const newer = prev.filter((m) => !known.has(m.id) && new Date(m.createdAt).getTime() > lastMs);
  return newer.length ? capBuffer([...rows, ...newer]) : rows;
}

// 최근 이력(오래된 것이 앞). 웹 :182-191 과 같은 조회. 실패는 null — 웹은 `data ?? []` 로 빈 목록을 그리지만
// 앱은 복귀 재조회에서 실패했을 때 들고 있던 목록을 지우면 안 되므로 호출부가 가른다.
export async function fetchChatHistory(): Promise<ChatMessage[] | null> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, user_id, nickname, content, created_at")
    .order("created_at", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);
  if (error) return null;
  return ((data ?? []) as ChatMessageRow[]).map(rowToMessage).reverse();
}

// 채팅방 데이터 — 패널(ChatRoom)이 마운트된 동안만 산다(설계서 §6.4).
//
//   마운트          구독 → 이력 조회(구독을 먼저 걸어 그 사이 메시지를 놓치지 않는다; 웹은 조회→구독
//                   순서인데 브라우저는 그 틈이 문제 된 적이 없어 그대로 두었고, 앱은 복귀 재조회가 있어
//                   mergeHistory 가 두 경로를 합친다)
//   background      해제(소켓을 붙들고 있어도 OS 가 끊는다 — 끊긴 채널을 남기면 복귀 뒤에도 조용히 안 온다)
//   active 복귀     재구독 + 이력 재조회(놓친 메시지·지워진 메시지 반영). inactive(제어 센터·전화)는 무시
//   언마운트        해제
//
// messages 가 null 이면 아직 첫 이력이 오지 않은 것("불러오는 중…").
export function useChatRoom(): { messages: ChatMessage[] | null; append: (message: ChatMessage) => void } {
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    let unsubscribe: (() => void) | null = null;

    const start = () => {
      if (unsubscribe) return;
      unsubscribe = subscribeRowChanges<ChatMessageRow>("chat_messages", {
        onInsert: (row) => setMessages((prev) => appendUnique(prev ?? [], rowToMessage(row))),
        // 관리자가 기록을 지우면(admin/chat) 열어 둔 채팅창에서도 바로 사라지게 한다(웹 주석 그대로).
        onDelete: (id) => setMessages((prev) => (prev ? prev.filter((m) => m.id !== id) : prev)),
      });
      void fetchChatHistory().then((rows) => {
        if (!alive) return;
        setMessages((prev) => (rows === null ? (prev ?? []) : mergeHistory(prev, rows)));
      });
    };
    const stop = () => {
      unsubscribe?.();
      unsubscribe = null;
    };

    start();
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "background") stop();
      else if (state === "active") start();
    });
    return () => {
      alive = false;
      stop();
      appState.remove();
    };
  }, []);

  const append = useCallback((message: ChatMessage) => {
    setMessages((prev) => appendUnique(prev ?? [], message));
  }, []);

  return { messages, append };
}

// 화면에 그릴 메시지 — 이력·실시간 수신 모두 여기서 걸러진다(웹 :151-160). 차단 집합은 게시판과 같은
// useBlockedIds(비로그인은 빈 집합). core filterBlocked 는 authorId 를 보므로 userId 를 그 이름으로 붙인다.
// 탈퇴한 회원(null)의 메시지는 언제나 남는다.
export function useVisibleChatMessages(messages: ChatMessage[] | null): ChatMessage[] | null {
  const { ids } = useBlockedIds();
  return useMemo(
    () => (messages === null ? null : filterBlocked(messages.map((m) => ({ ...m, authorId: m.userId })), ids)),
    [messages, ids],
  );
}

// 전송(EF chat-send). 응답의 message 를 호출부가 목록에 바로 붙인다(Realtime 보다 먼저 — appendUnique 가
// 뒤따라오는 같은 행을 거른다). 보낸 사람은 언제나 로그인 사용자라 userId 가 문자열이지만 목록 타입은
// null 을 허용하므로 그대로 들어간다.
export function useSendChatMessage() {
  return useMutation<ChatSendResponse["message"], Error, string>({
    mutationFn: async (content) => (await callEdge("chat-send", { content })).message,
  });
}

// 전송 실패 문구. 앱 전체 관례(handleEdgeError — 401 은 로그인 모달로, 426 은 강제 업데이트, 429 는
// "잠시 후 다시 시도해 주세요")를 따르되 **429 만 서버 문장 그대로** 보여준다: 채팅의 429 는 시간당 한도가
// 아니라 도배 판정(간격 1.5초·같은 말 반복·10초에 5건, core rules/chat.ts)이고 세 문장이 각각 다른 행동을
// 요구한다("같은 메시지를 반복해서 보낼 수 없어요." 를 "잠시 후" 로 뭉개면 무엇을 고쳐야 하는지 모른다).
// 웹은 서버 액션 문장을 그대로 보여준다. redirected 면 화면 이동이 끝난 것이라 호출부는 패널을 닫는다.
export async function chatSendErrorMessage(
  e: unknown,
  opts: { next?: string } = {},
): Promise<{ message: string; redirected: boolean }> {
  if (isEdgeError(e) && e.status === 429) return { message: e.message, redirected: false };
  const handled = await handleEdgeError(e, opts);
  return { message: handled.message, redirected: handled.redirected };
}
