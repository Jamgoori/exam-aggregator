import Storage from "expo-sqlite/kv-store";

// 클라이언트 상태(테마·OMR 분할 비율·힌트 dismiss·드래프트)는 expo-sqlite/kv-store 에
// 웹 localStorage 키 이름 **그대로** 둔다(설계서 §3.5). 웹이 sessionStorage 에 두는
// `*-shown-v1`·`review-fab:*` 는 여기 저장하지 않는다(메모리 전용 — 영구 저장하면 웹과
// 달리 다시는 안 뜬다). 정답·해설·멤버십은 어떤 키로도 여기 두지 않는다(AGENTS.md).
//
// 모든 호출은 try/catch — 저장소가 깨져도(디스크 부족·DB 잠금) 화면 동작을 막지 않는다.
export type KvKey =
  | "theme"
  | "cbt:omr-split-ratio"
  | "cbt-lock-hint-dismissed"
  | "examAggregator:favOnly"
  | `review-draft:${string}`
  | `cbt-draft:${string}`
  | "free-promo-hidden-day-v1"
  | "attendance-promo-hidden-day-v1"
  | "beta-notice-hidden-v1"
  | "migrated-v2";

export async function kvGet(key: KvKey): Promise<string | null> {
  try {
    return await Storage.getItem(key);
  } catch {
    return null;
  }
}

export async function kvSet(key: KvKey, value: string): Promise<void> {
  try {
    await Storage.setItem(key, value);
  } catch {
    // 무시
  }
}

export async function kvRemove(key: KvKey): Promise<void> {
  try {
    await Storage.removeItem(key);
  } catch {
    // 무시
  }
}

export async function kvGetJson<T>(key: KvKey): Promise<T | null> {
  const raw = await kvGet(key);
  if (raw == null) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export async function kvSetJson(key: KvKey, value: unknown): Promise<void> {
  await kvSet(key, JSON.stringify(value));
}

// 접두 일괄 삭제 — 로그아웃·탈퇴 시 `me:*`(사용자 스코프 값) 정리용(설계서 §6.5).
export async function kvRemoveByPrefix(prefix: string): Promise<void> {
  try {
    const keys = await Storage.getAllKeys();
    await Promise.all(keys.filter((k) => k.startsWith(prefix)).map((k) => Storage.removeItem(k)));
  } catch {
    // 무시
  }
}

// TanStack persister 가 쓰는 AsyncStorage 모양. 키는 persister 가 정한다
// (기본 REACT_QUERY_OFFLINE_CACHE) — 위 KvKey 목록 밖이라 별도 통로로 둔다.
export const kvStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      return await Storage.getItem(key);
    } catch {
      return null;
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      await Storage.setItem(key, value);
    } catch {
      // 무시
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      await Storage.removeItem(key);
    } catch {
      // 무시
    }
  },
};
