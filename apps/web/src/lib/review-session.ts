import "server-only";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSubjectWrongNoteQuestions } from "@/lib/wrong-notes";
import {
  collectAllReviewCandidates as collectAllReviewCandidatesRule,
  collectConceptReviewCandidates as collectConceptReviewCandidatesRule,
  collectPaperReviewCandidates as collectPaperReviewCandidatesRule,
  createAllReviewSessionForUser as createAllReviewSessionForUserRule,
  createConceptReviewSessionForUser as createConceptReviewSessionForUserRule,
  createDueReviewSessionForUser as createDueReviewSessionForUserRule,
  createPaperReviewSessionForUser as createPaperReviewSessionForUserRule,
  createReviewSessionForUser as createReviewSessionForUserRule,
  createReviewSessionFromItems as createReviewSessionFromItemsRule,
  filterQuestionsAnsweredByUser as filterQuestionsAnsweredByUserRule,
  findUnfinishedDueSession as findUnfinishedDueSessionRule,
  getReviewSessionView as getReviewSessionViewRule,
  markReviewItemGuessed as markReviewItemGuessedRule,
  submitReviewSessionForUser as submitReviewSessionForUserRule,
  type AllReviewCandidate,
  type CreateFromItemsOptions,
  type ReviewItemRef,
  type ReviewSessionView,
} from "@gongmoa/core/server";
import type { ReviewPickStrategy } from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 웹 어댑터. 섞어풀기·복습 세션의 규칙 본문(후보 정제·층 정원제 뽑기·세션 저장·
// requestId 멱등·채점 전 세션 선점·채점·상태·출석)은 packages/core/src/rules/
// review-session.ts 하나에 있고, Edge Function(review-create/submit/history)도 번들
// (_shared/core.mjs)로 같은 함수를 부른다. 여기는 service_role 클라이언트를 만들어
// 넘기고, 웹 전용 조회(과목 오답노트 "문항 모아보기")를 규칙에 끼워 주는 일만 한다.
//
// 웹은 requestId 를 넘기지 않는다(request_id = null) — 세션 생성 연타 규칙은 예전과 같다
// (shuffle 재사용 없음, 복습(due)만 24h findUnfinishedDueSession).

export type {
  AllReviewCandidate,
  ReviewItemView,
  ReviewSessionView,
} from "@gongmoa/core/server";

// 섞어풀기 세션을 만든다: 해당 과목의 (이미지가 있어 풀 수 있는) 오답에서 limit개를
// 골라 세션+문항을 저장한다. 후보는 과목 오답노트 "문항 모아보기"와 같은 조회
// (getSubjectWrongNoteQuestions)에서 온다 — 화면에 보이는 오답과 세션 후보가 같은 기준.
export async function createReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  input: {
    subjectSlug: string;
    onlyUnresolved: boolean;
    onlyDue?: boolean;
    limit?: number;
    strategy?: ReviewPickStrategy;
  },
): Promise<{ sessionId?: string; error?: string }> {
  return createReviewSessionForUserRule(supabase, createAdminClient(), userId, input, {
    loadSubject: (client, uid, slug) => getSubjectWrongNoteQuestions(client, uid, slug),
  });
}

export async function collectAllReviewCandidates(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean },
): Promise<AllReviewCandidate[]> {
  return collectAllReviewCandidatesRule(supabase, userId, opts);
}

export async function collectPaperReviewCandidates(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<ReviewItemRef[]> {
  return collectPaperReviewCandidatesRule(supabase, userId, paperIds);
}

export async function createPaperReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  paperIds: string[],
): Promise<{ sessionId?: string; error?: string }> {
  return createPaperReviewSessionForUserRule(supabase, createAdminClient(), userId, paperIds);
}

export async function createAllReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  opts: { onlyDue?: boolean; includeResolved?: boolean; strategy?: ReviewPickStrategy },
): Promise<{ sessionId?: string; error?: string }> {
  return createAllReviewSessionForUserRule(supabase, createAdminClient(), userId, opts);
}

// 사용자 입력에서 온 (문제지, 문항) 목록을 "내가 푼 적 있는 문항"으로 좁힌다. 사용자
// 세션 클라이언트(select-own RLS)로 조회하므로 userId 를 따로 넘기지 않는다.
export async function filterQuestionsAnsweredByUser(
  supabase: Supabase,
  items: ReviewItemRef[],
): Promise<ReviewItemRef[]> {
  return filterQuestionsAnsweredByUserRule(supabase, items);
}

// ⚠ items 를 검증하지 않고 그대로 믿는다 — 사용자 입력은 filterQuestionsAnsweredByUser 를
// 먼저 통과시킬 것(규칙 파일의 설명 참고).
export async function createReviewSessionFromItems(
  _supabase: Supabase,
  userId: string,
  items: ReviewItemRef[],
  limit?: number,
  opts: Pick<CreateFromItemsOptions, "keepOrder" | "scope" | "subjectId" | "maxLimit"> = {},
): Promise<{ sessionId?: string; error?: string }> {
  return createReviewSessionFromItemsRule(createAdminClient(), userId, items, limit, opts);
}

export async function createDueReviewSessionForUser(
  _supabase: Supabase,
  userId: string,
  items: ReviewItemRef[],
): Promise<{ sessionId?: string; error?: string }> {
  return createDueReviewSessionForUserRule(createAdminClient(), userId, items);
}

export async function findUnfinishedDueSession(
  _supabase: Supabase,
  userId: string,
  now: Date = new Date(),
): Promise<{ sessionId: string; total: number } | null> {
  return findUnfinishedDueSessionRule(createAdminClient(), userId, now);
}

export async function markReviewItemGuessed(
  _supabase: Supabase,
  userId: string,
  sessionId: string,
  position: number,
  now: Date = new Date(),
): Promise<{ error?: string }> {
  return markReviewItemGuessedRule(createAdminClient(), userId, sessionId, position, now);
}

export async function collectConceptReviewCandidates(
  supabase: Supabase,
  concept: string,
  subjectSlug: string | null,
  conceptId?: string | null,
): Promise<ReviewItemRef[]> {
  return collectConceptReviewCandidatesRule(
    supabase,
    createAdminClient(),
    concept,
    subjectSlug,
    conceptId,
  );
}

export async function createConceptReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  input: { concept: string; conceptId?: string | null; subjectSlug: string | null; limit?: number },
): Promise<{ sessionId?: string; error?: string }> {
  return createConceptReviewSessionForUserRule(supabase, createAdminClient(), userId, input);
}

export async function getReviewSessionView(
  supabase: Supabase,
  userId: string,
  sessionId: string,
): Promise<ReviewSessionView | null> {
  return getReviewSessionViewRule(supabase, createAdminClient(), userId, sessionId);
}

// 채점. 세션은 채점 **전에** 선점된다(설계서 §6.6) — 웹+앱 동시 제출이 겹쳐도 한쪽만
// 채점되고 나머지는 "이미 채점된 세션이에요."를 받는다.
export async function submitReviewSessionForUser(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  answers: (number | null)[],
): Promise<{ error?: string; view?: ReviewSessionView }> {
  const { error, view } = await submitReviewSessionForUserRule(
    supabase,
    createAdminClient(),
    userId,
    sessionId,
    answers,
  );
  return error ? { error } : { view };
}
