import { EDGE_UPDATE_REQUIRED, invokeEdge, isEdgeError, type EdgeContracts, type EdgeName } from "@gongmoa/core";
import { router } from "expo-router";
import { markUpdateRequired } from "./app-config";
import { clearAllCaches } from "./query-client";
import { supabase } from "./supabase";

// Edge Function 호출은 전부 여기를 지난다 — core invokeEdge 의 얇은 래퍼(설계서 §3.4 2번).
// 타임아웃은 §6.9: 기본 20초, CBT 제출만 60초(호출부가 timeoutMs 로 준다).
export function callEdge<N extends EdgeName>(
  name: N,
  body: EdgeContracts[N]["request"],
  opts: { timeoutMs?: number } = {},
): Promise<EdgeContracts[N]["response"]> {
  return invokeEdge(supabase, name, body, {
    signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
  });
}

export type EdgeErrorTone = "red" | "amber";
export type HandledEdgeError = {
  tone: EdgeErrorTone;
  message: string;
  // 401·426 처럼 화면 이동으로 처리된 경우 true — 호출부는 알림을 그리지 않는다.
  redirected: boolean;
};

const RATE_LIMIT_MESSAGE = "잠시 후 다시 시도해 주세요";
const FALLBACK_MESSAGE = "요청에 실패했어요. 잠시 후 다시 시도해 주세요.";

// 상태별 처리(§6.9 2번): 401(다른 기기에서 탈퇴·세션 폐기) → 로컬 signOut + 캐시 초기화 +
// /login?next= 모달; 426 update-required → ForceUpdateScreen; 429 → amber; 그 외 → red + 재시도.
export async function handleEdgeError(e: unknown, opts: { next?: string } = {}): Promise<HandledEdgeError> {
  if (isEdgeError(e)) {
    if (e.status === 401) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      await clearAllCaches();
      const next = opts.next ?? "/";
      router.replace(`/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(e.message)}`);
      return { tone: "red", message: e.message, redirected: true };
    }
    if (e.status === 426 || e.code === EDGE_UPDATE_REQUIRED) {
      markUpdateRequired(e.message);
      return { tone: "red", message: e.message, redirected: true };
    }
    if (e.status === 429) {
      return { tone: "amber", message: RATE_LIMIT_MESSAGE, redirected: false };
    }
    return { tone: "red", message: e.message, redirected: false };
  }
  const message = e instanceof Error && e.message ? e.message : FALLBACK_MESSAGE;
  return { tone: "red", message, redirected: false };
}
