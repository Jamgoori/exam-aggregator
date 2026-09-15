import * as Application from "expo-application";
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

// 강제 업데이트 게이트(설계서 §6.6). 웹 /api/app/config 가 플랫폼별 minBuild 를 주고,
// 앱은 expo-application 의 nativeBuildVersion(Android versionCode / iOS build)과 비교한다.
// Edge 가 426 update-required 를 돌려줘도 같은 게이트로 들어온다(edge.ts handleEdgeError).
// 이 주소는 앱이 웹 도메인을 부르는 다섯 경로 중 하나로 geo-block 면제 목록에 있다.
export type AppConfig = {
  minBuild: { ios: number; android: number };
  latestBuild: { ios: number; android: number };
  message: string | null;
  storeUrl: { ios: string | null; android: string | null };
};

type GateState = {
  updateRequired: boolean;
  message: string | null;
  storeUrl: string | null;
  latestAvailable: boolean;
};

const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL?.replace(/\/+$/, "");
const DEFAULT_MESSAGE = "새 버전이 필요해요. 스토어에서 업데이트한 뒤 다시 열어 주세요.";

let state: GateState = { updateRequired: false, message: null, storeUrl: null, latestAvailable: false };
const listeners = new Set<() => void>();

function setState(next: GateState) {
  state = next;
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function currentBuildNumber(): number {
  const n = Number(Application.nativeBuildVersion ?? "0");
  return Number.isSafeInteger(n) ? n : 0;
}

function platformKey(): "ios" | "android" {
  return Platform.OS === "ios" ? "ios" : "android";
}

// Edge 426 에서 호출 — 설정 재조회 없이 즉시 잠근다.
export function markUpdateRequired(message?: string | null): void {
  setState({
    ...state,
    updateRequired: true,
    message: message && message !== "update-required" ? message : state.message ?? DEFAULT_MESSAGE,
  });
}

export async function fetchAppConfig(): Promise<AppConfig | null> {
  if (!WEB_URL) return null;
  try {
    const res = await fetch(`${WEB_URL}/api/app/config`, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) return null;
    return (await res.json()) as AppConfig;
  } catch {
    return null;
  }
}

export async function refreshAppConfigGate(): Promise<void> {
  const config = await fetchAppConfig();
  if (!config) return;
  const key = platformKey();
  const build = currentBuildNumber();
  const min = config.minBuild?.[key] ?? 0;
  const latest = config.latestBuild?.[key] ?? 0;
  setState({
    // 0 은 "제한 없음"(웹 readAppConfig 규칙). 개발 빌드(build 0)는 절대 잠기지 않는다.
    updateRequired: state.updateRequired || (min > 0 && build > 0 && build < min),
    message: config.message ?? state.message ?? DEFAULT_MESSAGE,
    storeUrl: config.storeUrl?.[key] ?? null,
    latestAvailable: latest > 0 && build > 0 && build < latest,
  });
}

// 시작 시 한 번 + 포그라운드 복귀마다 확인. 반환값이 updateRequired 면 루트가
// ForceUpdateScreen 만 그린다.
export function useAppConfigGate(): GateState {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => {
    void refreshAppConfigGate();
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") void refreshAppConfigGate();
    });
    return () => sub.remove();
  }, []);
  return snapshot;
}
