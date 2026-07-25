import * as FileSystem from "expo-file-system";

// 오프라인 읽기 캐시.
//
// 앱은 웹과 달리 지하철·시험장처럼 신호가 끊기는 곳에서 열린다. 목록·오답노트가 통째로
// 빈 화면이 되지 않도록, 성공한 조회 결과를 JSON 파일로 남겨두고 네트워크가 실패하면
// 그걸 그려준다("마지막으로 본 내용").
//
// SQLite 대신 파일 JSON 인 이유: 캐시 대상이 목록 한 페이지·과목 목록 정도로 작고,
// 조건 검색이 필요 없다. 스키마·마이그레이션이 없는 쪽이 유지비가 싸다.
// 민감 정보(토큰)는 여기 넣지 않는다 — 세션은 SecureStore 담당(SECURITY.md 1번).
const CACHE_DIR = `${FileSystem.cacheDirectory}gongmoa-cache/`;

type Envelope<T> = { savedAt: string; data: T };

async function ensureDir(): Promise<void> {
  const info = await FileSystem.getInfoAsync(CACHE_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(CACHE_DIR, { intermediates: true });
  }
}

// 키에 슬래시·공백이 들어와도 파일명으로 안전하게.
function fileFor(key: string): string {
  return `${CACHE_DIR}${encodeURIComponent(key)}.json`;
}

export async function writeCache<T>(key: string, data: T): Promise<void> {
  try {
    await ensureDir();
    const envelope: Envelope<T> = { savedAt: new Date().toISOString(), data };
    await FileSystem.writeAsStringAsync(fileFor(key), JSON.stringify(envelope));
  } catch {
    // 캐시는 부가 기능이라 실패해도 화면 동작을 막지 않는다.
  }
}

export async function readCache<T>(
  key: string,
): Promise<{ data: T; savedAt: string } | null> {
  try {
    const info = await FileSystem.getInfoAsync(fileFor(key));
    if (!info.exists) return null;
    const raw = await FileSystem.readAsStringAsync(fileFor(key));
    const envelope = JSON.parse(raw) as Envelope<T>;
    return { data: envelope.data, savedAt: envelope.savedAt };
  } catch {
    return null;
  }
}

// 조회를 시도하고, 성공하면 캐시에 남기고, 실패하면 캐시로 되돌린다.
// fromCache 가 true 면 화면이 "오프라인 · 마지막 내용" 안내를 띄운다.
export async function fetchWithCache<T>(
  key: string,
  fetcher: () => Promise<T>,
): Promise<{ data: T; fromCache: boolean; savedAt: string | null }> {
  try {
    const data = await fetcher();
    await writeCache(key, data);
    return { data, fromCache: false, savedAt: null };
  } catch (error) {
    const cached = await readCache<T>(key);
    if (cached) return { data: cached.data, fromCache: true, savedAt: cached.savedAt };
    throw error;
  }
}

// 로그아웃·탈퇴 시 개인 데이터가 기기에 남지 않도록 비운다.
export async function clearCache(): Promise<void> {
  try {
    await FileSystem.deleteAsync(CACHE_DIR, { idempotent: true });
  } catch {
    // 무시
  }
}
