import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase } from "./supabase";

// Realtime 구독 헬퍼(설계서 §6.4). 앱에서 Realtime 을 쓰는 곳은 채팅 하나뿐이라 postgres_changes 의
// INSERT·DELETE 두 이벤트만 감싼다 — 웹 chat-panel.tsx 의 `channel(...).on(...).subscribe()` /
// `removeChannel` 을 그대로 옮긴 것이고, 생명주기(열 때 구독·닫을 때 해제·백그라운드 해제·복귀 재구독)는
// 호출부(queries/chat.ts useChatRoom)가 잡는다. 여기는 "구독 하나 = 해제 함수 하나" 만 책임진다.
//
// 토픽에 일련번호를 붙이는 이유(웹은 "chat_messages" 고정): realtime-js 2.110 의 client.channel(topic) 은
// 같은 토픽의 채널이 아직 목록에 있으면 **그 채널을 그대로 돌려주고**, removeChannel 은 leave 응답을
// (백그라운드에서 끊긴 소켓이면 타임아웃 10초를) 기다린 뒤에야 목록에서 뺀다. 백그라운드 진입에서 해제한
// 직후 포그라운드 복귀로 다시 구독하면 해제 중인 옛 채널을 받아 아무 이벤트도 못 받는다. 웹은 마운트마다
// 한 번만 구독해 이 경합이 없다. 토픽은 클라이언트 쪽 이름표일 뿐이라(postgres_changes 는 테이블 필터로
// 받는다) 번호를 붙여도 서버 동작은 같다.
let topicSeq = 0;

export type RowChangeHandlers<Row extends Record<string, unknown>> = {
  onInsert?: (row: Row) => void;
  // DELETE 페이로드에는 replica identity 기본값 탓에 기본키만 담겨 온다(웹 주석 그대로) — id 만 넘긴다.
  onDelete?: (id: string) => void;
};

// public 스키마 테이블 하나의 행 변경을 받는다. 돌려주는 함수를 부르면 해제된다(여러 번 불러도 안전).
export function subscribeRowChanges<Row extends Record<string, unknown>>(
  table: string,
  handlers: RowChangeHandlers<Row>,
): () => void {
  const channel: RealtimeChannel = supabase.channel(`${table}:${++topicSeq}`);
  const { onInsert, onDelete } = handlers;
  if (onInsert) {
    channel.on<Row>("postgres_changes", { event: "INSERT", schema: "public", table }, (payload) => {
      onInsert(payload.new);
    });
  }
  if (onDelete) {
    channel.on<Row>("postgres_changes", { event: "DELETE", schema: "public", table }, (payload) => {
      const deletedId = (payload.old as { id?: unknown }).id;
      if (typeof deletedId === "string" && deletedId) onDelete(deletedId);
    });
  }
  channel.subscribe();

  let released = false;
  return () => {
    if (released) return;
    released = true;
    // 결과('ok' | 'timed out' | 'error')는 쓸 데가 없다 — 끊긴 소켓에서는 타임아웃으로 끝나고, 어느 쪽이든
    // 채널은 정리된다.
    void supabase.removeChannel(channel);
  };
}
