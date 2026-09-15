import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPublicClient } from "@/lib/supabase/public";
import { fetchAllExamPapers } from "@/lib/all-papers";
import {
  buildMixHubIndex,
  buildMixPool,
  createMixSessionForUser as createMixSessionForUserRule,
  createRetryFromMixSession as createRetryFromMixSessionRule,
  fetchPlayableQuestionCounts,
  getMixSessionWrongNote as getMixSessionWrongNoteRule,
  getSubjectBySlug,
  listMixSessions as listMixSessionsRule,
  listRecentMixSessions as listRecentMixSessionsRule,
  toMixOverview,
  type CreateMixSessionResult,
  type MixHubIndex,
  type MixOverview,
  type MixPool,
  type MixSessionBrief,
  type MixSessionSummary,
  type MixSessionWrongNote,
} from "@gongmoa/core/server";
import type { MixYearRange } from "@gongmoa/core";

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 웹 어댑터. 기출 섞어풀기의 규칙 본문(출제 풀 계산·급수/연도 필터·문항 뽑기·세션 저장·
// 기록 카드·재도전)은 packages/core/src/rules/mix-practice.ts 에 있다. 여기에 남는 것은
// Next 캐시('use cache')로 감싸는 세 조회(getMixPool·getMixHubIndex·getMixOverview)와
// 클라이언트(공개·admin) 생성뿐이다.

export {
  MIX_SCOPE,
  embedOne,
  toMixSessionBriefs,
  type CreateMixSessionResult,
  type MixCountCell,
  type MixHubIndex,
  type MixHubSubject,
  type MixHubTier,
  type MixHubUnit,
  type MixLevelGroup,
  type MixOverview,
  type MixPool,
  type MixSessionBrief,
  type MixSessionQuestion,
  type MixSessionRow,
  type MixSessionSummary,
  type MixSessionWrongNote,
} from "@gongmoa/core/server";

// 과목 하나의 출제 풀. 문제지 수백 장 × 문항 수십 개를 훑는 조회라 요청마다 돌리지
// 않고 캐시한다 — 로그인 여부와 무관한 공개 자료(문항 이미지 존재 여부·정답 등록
// 여부)만 담고 정답 자체는 싣지 않는다. 새 문제지·정답이 올라오면 홈 데이터와 같은
// 태그로 함께 갱신되고, 그 전에도 한 시간이면 저절로 새로 만든다.
export async function getMixPool(subjectId: string): Promise<MixPool> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  return buildMixPool(createPublicClient(), createAdminClient(), subjectId);
}

// 섞어풀기 허브(/mix)의 급수 탭·과목 목록. 조회(문제지 목록·과목·집계 RPC)만 여기서 하고
// 집계는 core buildMixHubIndex 가 한다.
export async function getMixHubIndex(): Promise<MixHubIndex> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const supabase = createPublicClient();
  const [{ papers, examTypes }, { data: subjectRows }, playable] = await Promise.all([
    fetchAllExamPapers(supabase),
    supabase.from("subjects").select("id, slug, name"),
    fetchPlayableQuestionCounts(supabase),
  ]);
  return buildMixHubIndex({
    papers,
    examTypes,
    subjects: (subjectRows ?? []) as { id: string; slug: string; name: string }[],
    playable,
  });
}

// 시작 화면용 요약. 로그인과 무관한 공개 통계라 사용자 클라이언트가 필요 없고,
// generateMetadata 와 본문이 같은 요청에서 두 번 부르므로 통째로 캐시한다.
export async function getMixOverview(slug: string): Promise<MixOverview | null> {
  "use cache";
  cacheLife({ revalidate: 3600 });
  cacheTag("home-data");

  const subject = await getSubjectBySlug(createPublicClient(), slug);
  if (!subject) return null;
  return toMixOverview(subject, await getMixPool(subject.id));
}

export async function createMixSessionForUser(
  supabase: Supabase,
  userId: string,
  input: {
    subjectSlug: string;
    limit?: number;
    levels?: string[];
    year?: Partial<MixYearRange> | null;
  },
): Promise<CreateMixSessionResult> {
  return createMixSessionForUserRule(supabase, createAdminClient(), userId, input, {
    getMixPool,
  });
}

export async function listMixSessions(
  supabase: Supabase,
  userId: string,
  subjectId: string,
): Promise<MixSessionSummary[]> {
  return listMixSessionsRule(supabase, createAdminClient(), userId, subjectId, { getMixPool });
}

export async function listRecentMixSessions(
  userId: string,
  limit = 5,
): Promise<MixSessionBrief[]> {
  return listRecentMixSessionsRule(createAdminClient(), userId, limit);
}

export async function getMixSessionWrongNote(
  supabase: Supabase,
  userId: string,
  sessionId: string,
  includeExplanations = true,
): Promise<MixSessionWrongNote | null> {
  return getMixSessionWrongNoteRule(
    supabase,
    createAdminClient(),
    userId,
    sessionId,
    includeExplanations,
    { getMixPool },
  );
}

export async function createRetryFromMixSession(
  _supabase: Supabase,
  userId: string,
  sessionId: string,
): Promise<{ sessionId?: string; error?: string }> {
  return createRetryFromMixSessionRule(createAdminClient(), userId, sessionId);
}
