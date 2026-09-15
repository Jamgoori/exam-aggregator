import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { StudyPhase } from "@gongmoa/core";
import {
  getDiagnosisPausedSubjectIds as getDiagnosisPausedSubjectIdsRule,
  getExcludedDiagnosisSubjectSlugs as getExcludedDiagnosisSubjectSlugsRule,
  getPausedSubjectIds as getPausedSubjectIdsRule,
  getReviewPrefs as getReviewPrefsRule,
  getReviewSubjectOptions as getReviewSubjectOptionsRule,
  getStoredStudyPhase as getStoredStudyPhaseRule,
  restoreSuspendedQuestions as restoreSuspendedQuestionsRule,
  saveStudyPhase as saveStudyPhaseRule,
  setDailyLimit as setDailyLimitRule,
  setDiagnosisSubjectPaused as setDiagnosisSubjectPausedRule,
  setSubjectPaused as setSubjectPausedRule,
  spreadOverdueBacklog as spreadOverdueBacklogRule,
  type RestoreSuspendedResult,
  type ReviewPrefs,
  type ReviewSubjectOption,
  type SetDailyLimitResult,
  type SetDiagnosisSubjectResult,
  type SetPausedResult,
  type SpreadBacklogResult,
} from "@gongmoa/core/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 웹 어댑터. 복습 설정(하루 문항 수·과목 보류·진단 제외 과목·학습 국면)과 스케줄
// 재분산의 규칙 본문은 packages/core/src/rules/review-preferences.ts 에 있다.
//
// review_preferences 읽기·쓰기는 지금처럼 **사용자 세션 클라이언트(RLS: select/insert/
// update own)** 로 한다 — 설계서 §6.7 #13 의 "웹 RLS 정책 회수" 여부는 §13 질문 15 로
// 미결이라 admin 으로 바꾸지 않는다(규칙은 client 를 주입받으므로, 회수하기로 하면 여기서
// createAdminClient() 를 넘기기만 하면 된다). user_question_status 를 고치는 재분산만
// service_role 이다(그 테이블은 쓰기 정책이 없다).

export type {
  RestoreSuspendedResult,
  ReviewPrefs,
  ReviewSubjectOption,
  SetDailyLimitResult,
  SetDiagnosisSubjectResult,
  SetPausedResult,
  SpreadBacklogResult,
} from "@gongmoa/core/server";

export async function getReviewPrefs(supabase: Supabase, userId: string): Promise<ReviewPrefs> {
  return getReviewPrefsRule(supabase, userId);
}

export async function getDiagnosisPausedSubjectIds(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  return getDiagnosisPausedSubjectIdsRule(supabase, userId);
}

export async function getExcludedDiagnosisSubjectSlugs(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  return getExcludedDiagnosisSubjectSlugsRule(supabase, userId);
}

export async function setDiagnosisSubjectPaused(
  supabase: Supabase,
  userId: string,
  subjectId: string,
  paused: boolean,
  now: Date = new Date(),
): Promise<SetDiagnosisSubjectResult> {
  return setDiagnosisSubjectPausedRule(supabase, userId, subjectId, paused, now);
}

export async function getStoredStudyPhase(
  supabase: Supabase,
  userId: string,
): Promise<StudyPhase | null> {
  return getStoredStudyPhaseRule(supabase, userId);
}

export async function saveStudyPhase(
  supabase: Supabase,
  userId: string,
  phase: StudyPhase,
  now: Date = new Date(),
): Promise<void> {
  return saveStudyPhaseRule(supabase, userId, phase, now);
}

export async function getPausedSubjectIds(
  supabase: Supabase,
  userId: string,
): Promise<Set<string>> {
  return getPausedSubjectIdsRule(supabase, userId);
}

export async function setDailyLimit(
  supabase: Supabase,
  userId: string,
  limit: number,
  now: Date = new Date(),
): Promise<SetDailyLimitResult> {
  return setDailyLimitRule(supabase, userId, limit, now);
}

export async function getReviewSubjectOptions(
  supabase: Supabase,
  userId: string,
): Promise<ReviewSubjectOption[]> {
  return getReviewSubjectOptionsRule(supabase, userId);
}

export async function spreadOverdueBacklog(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<SpreadBacklogResult> {
  return spreadOverdueBacklogRule(supabase, createAdminClient(), userId, now);
}

export async function restoreSuspendedQuestions(
  supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<RestoreSuspendedResult> {
  return restoreSuspendedQuestionsRule(supabase, createAdminClient(), userId, now);
}

export async function setSubjectPaused(
  supabase: Supabase,
  userId: string,
  subjectId: string,
  paused: boolean,
  now: Date = new Date(),
): Promise<SetPausedResult> {
  return setSubjectPausedRule(supabase, createAdminClient(), userId, subjectId, paused, now);
}
