import * as SecureStore from "expo-secure-store";

// Supabase 세션(access/refresh 토큰)을 OS 보안 저장소(iOS Keychain / Android
// Keystore)에 넣는 어댑터. AsyncStorage 는 평문이라 루팅/탈옥 기기에서 다른 앱이
// 읽을 수 있어, 리프레시 토큰 같은 장기 자격증명은 SecureStore 에 둔다.
//
// SecureStore 는 항목당 크기 제한(안드로이드 ~2KB)이 있어 세션 JSON 이 넘칠 수 있다.
// 값을 2KB 청크로 쪼개 여러 키로 저장하고, 청크 수를 메타 키에 기록한다.

const CHUNK = 2000;

function chunkKey(key: string, i: number) {
  return `${key}.${i}`;
}
function countKey(key: string) {
  return `${key}.__n`;
}

async function clearChunks(key: string) {
  const nRaw = await SecureStore.getItemAsync(countKey(key));
  const n = nRaw ? parseInt(nRaw, 10) : 0;
  const jobs: Promise<void>[] = [SecureStore.deleteItemAsync(countKey(key))];
  for (let i = 0; i < n; i++) jobs.push(SecureStore.deleteItemAsync(chunkKey(key, i)));
  await Promise.all(jobs);
}

export const SecureStorage = {
  async getItem(key: string): Promise<string | null> {
    const nRaw = await SecureStore.getItemAsync(countKey(key));
    if (nRaw == null) {
      // 단일 값(청크 안 된)도 지원 — 마이그레이션·소형 값.
      return SecureStore.getItemAsync(key);
    }
    const n = parseInt(nRaw, 10);
    let out = "";
    for (let i = 0; i < n; i++) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) return null; // 손상 → 없음 취급(재로그인)
      out += part;
    }
    return out;
  },

  async setItem(key: string, value: string): Promise<void> {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
    if (value.length <= CHUNK) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    const parts: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK) parts.push(value.slice(i, i + CHUNK));
    await SecureStore.setItemAsync(countKey(key), String(parts.length));
    await Promise.all(parts.map((p, i) => SecureStore.setItemAsync(chunkKey(key, i), p)));
  },

  async removeItem(key: string): Promise<void> {
    await clearChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};
