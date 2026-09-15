import { QueryClient, defaultShouldDehydrateQuery, focusManager, onlineManager } from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import NetInfo from "@react-native-community/netinfo";
import * as Application from "expo-application";
import { AppState } from "react-native";
import { kvRemoveByPrefix, kvStorage } from "./kv";

// 서버 상태는 전부 TanStack Query(설계서 §6.3). 키 접두는 ['catalog', …] / ['me', userId, …]
// / ['edge', name, …] 셋. staleTime 은 등급별 상수를 쿼리 옵션에서 골라 쓴다.
export const STALE = {
  // 카탈로그(문제지 목록·과목·시험 인덱스·홈 통계·슬러그 맵) — 웹 'use cache' 300s 와 동일.
  catalog: 5 * 60_000,
  // 본인 RLS 데이터(응시 목록·오답 그룹·즐겨찾기·메모·표시·출석·알림).
  me: 30_000,
  // 멤버십(membership-get) — 메모리만(meta.persist:false).
  membership: 60_000,
  // Edge 결과(채점·복습 세션·진단) — 항상 새로.
  edge: 0,
} as const;

// 카탈로그 디스크 보존 기간(gcTime·persister maxAge 동일).
export const CATALOG_GC_MS = 7 * 24 * 60 * 60_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: STALE.me,
      gcTime: CATALOG_GC_MS,
      refetchOnReconnect: true,
    },
  },
});

// dehydrate 한 클라이언트 전체가 하나의 kv 키에 저장된다. 정답·해설·멤버십·진단 본문은
// 디스크에 남기지 않는다 — ['edge', …] 접두와 meta.persist === false 를 제외(§6.5).
export const persister = createAsyncStoragePersister({
  storage: kvStorage,
  key: "REACT_QUERY_OFFLINE_CACHE",
  throttleTime: 1_000,
});

// 계정이 바뀌면 이전 사용자의 블롭이 복원되지 않도록 buster 에 userId 를 섞는다.
export function persistBuster(userId: string | null | undefined): string {
  return `${Application.nativeBuildVersion ?? "dev"}:${userId ?? "anon"}`;
}

export function buildPersistOptions(
  userId: string | null | undefined,
): Omit<PersistQueryClientOptions, "queryClient"> {
  return {
    persister,
    buster: persistBuster(userId),
    maxAge: CATALOG_GC_MS,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        defaultShouldDehydrateQuery(query) &&
        query.queryKey[0] !== "edge" &&
        query.meta?.persist !== false,
    },
  };
}

// onlineManager ← NetInfo, focusManager ← AppState. 루트 레이아웃 모듈에서 한 번 호출.
// "연결됨"만으로는 부족해서(붙었지만 인터넷이 안 되는 와이파이) isInternetReachable 까지 본다.
let bound = false;
export function bindQueryManagers(): void {
  if (bound) return;
  bound = true;
  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(!!state.isConnected && state.isInternetReachable !== false);
    }),
  );
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener("change", (state) => handleFocus(state === "active"));
    return () => sub.remove();
  });
}

// 로그아웃·탈퇴·401: 메모리 캐시 + 퍼시스트 블롭 + kv `me:*` 를 한 번에(§6.5).
export async function clearAllCaches(): Promise<void> {
  queryClient.clear();
  await Promise.allSettled([persister.removeClient(), kvRemoveByPrefix("me:")]);
}
