import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionSchedule } from "@gongmoa/core";
import {
  collectDueCandidates as collectDueCandidatesRule,
  collectDueQueueItems as collectDueQueueItemsRule,
  collectExtraQueueItems as collectExtraQueueItemsRule,
  getDueReviewSummary as getDueReviewSummaryRule,
  getSessionSchedule as getSessionScheduleRule,
  type AdminFactory,
  type DueCandidateSet,
  type DueReviewSummary,
} from "@gongmoa/core/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 웹 어댑터. 복습 큐 조회 계층(후보 정제·승격·요약·세션 스케줄)의 본문은
// packages/core/src/rules/review-queue.ts 에 있고, 편성 규칙은 packages/core/src/
// review-queue.ts 에 있다. 여기는 service_role 클라이언트 팩토리(테스트가 갈아끼우는
// 이음매)의 기본값을 채워 넘기는 일만 한다.

export type { AdminFactory, DueReviewSummary } from "@gongmoa/core/server";

export async function collectDueCandidates(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
  adminFactory: AdminFactory = createAdminClient,
): Promise<DueCandidateSet> {
  return collectDueCandidatesRule(supabase, userId, now, adminFactory);
}

export async function getDueReviewSummary(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
  adminFactory: AdminFactory = createAdminClient,
): Promise<DueReviewSummary> {
  return getDueReviewSummaryRule(supabase, userId, now, adminFactory);
}

export async function getSessionSchedule(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  now: Date = new Date(),
  adminFactory: AdminFactory = createAdminClient,
): Promise<SessionSchedule | null> {
  return getSessionScheduleRule(supabase, userId, sessionId, now, adminFactory);
}

export async function collectDueQueueItems(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
  adminFactory: AdminFactory = createAdminClient,
): Promise<{ paperId: string; questionNumber: number }[]> {
  return collectDueQueueItemsRule(supabase, userId, now, adminFactory);
}

export async function collectExtraQueueItems(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
  adminFactory: AdminFactory = createAdminClient,
): Promise<{ items: { paperId: string; questionNumber: number }[]; error?: string }> {
  return collectExtraQueueItemsRule(supabase, userId, now, adminFactory);
}
