import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveStatusTargets as resolveStatusTargetsRule,
  type StatusTargetItem,
} from "@gongmoa/core/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 복습·섞어풀기 채점의 "대표 id → 실제 상태 행이 있는 문제지" 되짚기의 웹 어댑터.
// 규칙 본문과 배경 설명은 packages/core/src/rules/status-targets.ts 에 있고, Edge
// review-submit 도 번들로 같은 함수를 쓴다(예전 Edge 자체 알고리즘은 버렸다).
export { statusTargetKey, type StatusTargetItem } from "@gongmoa/core/server";

// service_role 키가 없는 환경(테스트 등)에서는 정답 대조를 조용히 건너뛰고 메타데이터만
// 쓴다 — 표시 통합(dedup-papers.ts)과 같은 처리.
function tryAdminClient() {
  try {
    return createAdminClient();
  } catch {
    return null;
  }
}

export async function resolveStatusTargets(
  supabase: Supabase,
  userId: string,
  items: StatusTargetItem[],
): Promise<Map<string, string[]>> {
  return resolveStatusTargetsRule(supabase, userId, items, {
    answersClient: tryAdminClient(),
  });
}
