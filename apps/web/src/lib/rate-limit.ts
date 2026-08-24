// 고정 창(fixed window) 유량 제한 — 순수 로직(테스트: webhook-guard.test.ts).
//
// 원래 웹훅 전용이었는데 두 번째 사용처(비회원 댓글 비밀번호 대입 방지)가 생겨서
// 여기로 옮겼다. webhook-guard 는 이 모듈을 다시 내보내므로 기존 import 는 그대로다.
//
// 서버리스라 인스턴스마다 각자 센다 = 전역 한도가 아니다. 그래도 인스턴스 하나가
// 감당할 수 있는 최대 증폭은 이걸로 묶인다. 정확한 전역 제한이 필요하면 저장소가
// 필요한데, 이 두 자리 때문에 Redis 를 들이는 건 과하다.

export type RateLimiter = {
  /** 이번 요청을 처리해도 되는지. false 면 한도 초과. */
  take(key: string, now?: number): boolean;
};

/**
 * 고정 창(fixed window) 유량 제한.
 *
 * 한도는 용도에 따라 정반대로 잡아야 한다:
 *  · 웹훅처럼 **놓치면 안 되는 정상 트래픽**이 지나는 자리는 넉넉하게. 여기 걸려서
 *    진짜 결제 웹훅이 버려지면 돈은 받고 멤버십은 안 켜진 주문이 생긴다 — 공격을
 *    조금 덜 막는 것보다 그쪽이 훨씬 나쁘다.
 *  · 비밀번호 대입처럼 **정상 사용자가 몇 번이면 끝나는** 자리는 빡빡하게.
 */
export function createRateLimiter(options: {
  limit: number;
  windowMs: number;
  /** 메모리 상한. 넘으면 만료된 것부터 비우고, 그래도 넘으면 통째로 비운다. */
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs, maxKeys = 10_000 } = options;
  const windows = new Map<string, { count: number; resetAt: number }>();

  return {
    take(key: string, now: number = Date.now()): boolean {
      const current = windows.get(key);
      if (!current || now >= current.resetAt) {
        if (windows.size >= maxKeys) evict(windows, now, maxKeys);
        windows.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      current.count++;
      return current.count <= limit;
    },
  };
}

function evict(
  windows: Map<string, { count: number; resetAt: number }>,
  now: number,
  maxKeys: number,
) {
  for (const [key, window] of windows) {
    if (now >= window.resetAt) windows.delete(key);
  }
  // 만료된 게 없을 만큼 몰렸다면(=공격 중) 통째로 비운다. 여기서 붙잡고 있어 봐야
  // 메모리만 먹고, 비워도 다음 창에서 다시 세기 시작한다.
  if (windows.size >= maxKeys) windows.clear();
}

