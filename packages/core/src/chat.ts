// 채팅 메시지 정책 (오픈카카오톡 대체 채팅방). 본문 길이·도배 판정 규칙을 여기
// 하나로 모아 서버 액션이 그대로 쓰게 한다 — comment-constraints.ts 와 같은 이유.
//
// 실제 DB 조회(직전 메시지·최근 전송 횟수)는 서버 액션(apps/web/src/app/chat/actions.ts)
// 이 하고, 그 결과를 여기 순수 함수에 넘겨 통과/거절만 판정한다(테스트 용이성 + 웹·
// 앱이 같은 규칙을 공유할 수 있게 하기 위해 — packages/core 헤더 주석의 DI 원칙과 같다).
export const CHAT_CONTENT_MAX = 300;

// 최소 전송 간격. 사람이 타이핑하는 속도보다는 훨씬 짧아 정상 대화를 막지 않으면서,
// 자동화된 연타 도배는 걸러낸다.
export const CHAT_MIN_INTERVAL_MS = 1500;

// 짧은 창(burst window) 안에 이 개수를 넘겨 보내면 내용이 매번 달라도 도배로 본다 —
// 최소 간격만으로는 "간격은 지키지만 계속 보내는" 패턴을 못 막는다.
export const CHAT_BURST_WINDOW_MS = 10_000;
export const CHAT_BURST_LIMIT = 5;

export type ChatGuardResult = { ok: true } | { ok: false; error: string };

// 직전 메시지와 비교해 도배 여부를 판정한다. lastMessage 가 없으면(첫 메시지) 항상 통과.
export function checkChatFlood(
  lastMessage: { content: string; createdAtMs: number } | null,
  content: string,
  nowMs: number,
): ChatGuardResult {
  if (!lastMessage) return { ok: true };

  if (nowMs - lastMessage.createdAtMs < CHAT_MIN_INTERVAL_MS) {
    return { ok: false, error: "너무 빨리 보내고 있어요. 잠시 후 다시 시도해주세요." };
  }

  // 대소문자·앞뒤 공백만 다른 것도 같은 말로 본다(복붙 도배 우회 방지).
  if (lastMessage.content.trim().toLowerCase() === content.trim().toLowerCase()) {
    return { ok: false, error: "같은 메시지를 반복해서 보낼 수 없어요." };
  }

  return { ok: true };
}

// 최근 창 안의 전송 횟수로 판정한다(recentCount 는 호출부가 미리 집계해서 넘긴다).
export function checkChatBurst(recentCount: number): ChatGuardResult {
  if (recentCount >= CHAT_BURST_LIMIT) {
    return { ok: false, error: "메시지를 너무 자주 보내고 있어요. 잠시 후 다시 시도해주세요." };
  }
  return { ok: true };
}
